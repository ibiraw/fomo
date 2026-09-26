/**
 * @file ws-gateway.ts
 * @description WebSocket server the extensions connect to. Clients log in with their account key (created on first
 *              use), then send order commands for their own account. Order events go only to the owner's
 *              connections; price ticks only to clients interested in that token. It is also the
 *              TradeExecutorPort: each account's trades are sent to that account's executor (its extension).
 *              Limits: request rate per connection, viewed tokens per connection, new accounts per IP.
 * @author Reborn1987
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { AccountService } from '../../core/accounts/account-service.js';
import type { WalletConfirmers } from '../../core/accounts/wallet-confirmers.js';
import { AuthError, FomoError } from '../../core/errors.js';
import type { Order } from '../../core/orders/order.js';
import type { EngineEvent, OrderEngine } from '../../core/orders/order-engine.js';
import type { TokenInfoService } from '../../core/tokens/token-info-service.js';
import type { Account } from '../../ports/account-store.js';
import { TradeExecutorPort, type ExecutionResult } from '../../ports/trade-executor.js';
import { ClientMessageSchema, type ClientMessage } from './protocol.js';

/** Abuse limits. */
export interface GatewayLimits {
  /** Messages per second a connection may send on average (bursts up to twice that). */
  readonly messagesPerSecond: number;
  /** Tokens one connection may keep a live price for without having orders on them. */
  readonly viewedTokens: number;
  /** New accounts one IP address may create per hour. */
  readonly accountsPerIpPerHour: number;
}

export const DEFAULT_LIMITS: GatewayLimits = { messagesPerSecond: 20, viewedTokens: 8, accountsPerIpPerHour: 5 };

/** Gateway tuning. */
export interface GatewayOptions {
  readonly host: string;
  readonly port: number;
  /** How long to wait for the extension to report a trade result. */
  readonly execTimeoutMs: number;
  /** Min interval between price broadcasts per token. */
  readonly tickThrottleMs: number;
  /** App-level keepalive (keeps the MV3 service worker alive). */
  readonly pingIntervalMs: number;
  /** Behind Cloudflare: take the client IP from CF-Connecting-IP. */
  readonly trustProxy?: boolean;
  readonly limits?: GatewayLimits;
}

/** Per-connection state. */
interface Client {
  readonly ws: WebSocket;
  readonly ip: string;
  userId: string | null;
  /** Tokens this connection asked live prices for (price.watch). */
  readonly viewed: Set<string>;
  /** Token bucket for the message rate limit. */
  tokens: number;
  refilledAt: number;
}

/** An execution awaiting the extension's answer. */
interface PendingExec {
  readonly resolve: (r: ExecutionResult) => void;
  readonly timer: NodeJS.Timeout;
  readonly client: Client;
}

/** Statuses whose token prices an account needs. */
const isActive = (o: Order): boolean => o.status === 'open' || o.status === 'triggered' || o.status === 'executing';

/** What a client sees about its account. */
const accountView = (a: Account) => ({ id: a.id, wallets: a.wallets });

export class WsGateway extends TradeExecutorPort {
  private wss: WebSocketServer | null = null;
  private engine: OrderEngine | null = null;
  private tokenInfo: TokenInfoService | null = null;
  private accounts: AccountService | null = null;
  private confirmers: WalletConfirmers | null = null;
  private readonly clients = new Set<Client>();
  /** Newest executor connection per account. */
  private readonly executors = new Map<string, Client>();
  /** Tokens each account has active orders on (for tick routing). */
  private readonly orderMints = new Map<string, Set<string>>();
  private readonly pending = new Map<string, PendingExec>();
  private readonly lastTickSent = new Map<string, number>();
  /** Account creations per IP within the current hour window. */
  private readonly created = new Map<string, { count: number; since: number }>();
  private readyCbs: ((userId: string) => void)[] = [];
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly limits: GatewayLimits;

  /** @param opts server options @param log logger for connection events @param now clock */
  constructor(private readonly opts: GatewayOptions, private readonly log: (msg: string) => void, private readonly now: () => number = Date.now) {
    super();
    this.limits = opts.limits ?? DEFAULT_LIMITS;
  }

  /** Wires the core services (they and the gateway depend on each other; set after all exist). */
  attach(engine: OrderEngine, accounts: AccountService, confirmers: WalletConfirmers, tokenInfo: TokenInfoService | null = null): void {
    this.engine = engine;
    this.accounts = accounts;
    this.confirmers = confirmers;
    this.tokenInfo = tokenInfo;
  }

  /** Starts listening. Resolves once the port is bound. */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host,
        port: this.opts.port,
        maxPayload: 64 * 1024,
        verifyClient: ({ req }: { req: IncomingMessage }) => this.originAllowed(req),
      });
      wss.once('listening', () => resolve());
      wss.once('error', reject);
      wss.on('connection', (ws, req) => this.onConnection(ws, req));
      this.wss = wss;
      this.pingTimer = setInterval(() => this.broadcast({ type: 'ping' }), this.opts.pingIntervalMs);
    });
  }

  /** Bound port (useful when listening on port 0 in tests). */
  port(): number {
    const addr = this.wss?.address();
    if (!addr || typeof addr === 'string') throw new FomoError('Gateway is not listening');
    return addr.port;
  }

  /** Closes all connections and the server. */
  async close(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const [id, p] of this.pending) this.settle(id, p, { ok: false, kind: 'unknown', message: 'Gateway shut down' });
    for (const c of this.clients) c.ws.terminate();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }

  /** Engine event sink: order changes to the owner, throttled price ticks to interested clients. */
  handleEngineEvent(e: EngineEvent): void {
    if (e.type === 'order') {
      this.refreshOrderMints(e.order.userId);
      for (const c of this.clients) if (c.userId === e.order.userId) this.send(c, { type: 'order', order: e.order });
      return;
    }
    const last = this.lastTickSent.get(e.tick.mint) ?? 0;
    if (e.tick.receivedAt - last < this.opts.tickThrottleMs) return;
    this.lastTickSent.set(e.tick.mint, e.tick.receivedAt);
    for (const c of this.clients) if (this.wants(c, e.tick.mint)) this.send(c, { type: 'tick', tick: e.tick });
  }

  // ---- TradeExecutorPort ----

  /** Ready when the account has an executor connection open. */
  isReady(userId: string): boolean {
    return this.executors.has(userId);
  }

  /** Stores a readiness callback. */
  onReady(cb: (userId: string) => void): void {
    this.readyCbs.push(cb);
  }

  /** Sends the trade to its owner's extension and waits for the result (or times out as 'timeout'). */
  execute(order: Order): Promise<ExecutionResult> {
    const client = this.executors.get(order.userId);
    if (!client) return Promise.resolve({ ok: false, kind: 'ui_error', message: 'Your extension is not connected' });
    const execId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(execId);
        if (p) this.settle(execId, p, { ok: false, kind: 'timeout', message: `No result from extension within ${this.opts.execTimeoutMs / 1000}s` });
      }, this.opts.execTimeoutMs);
      this.pending.set(execId, { resolve, timer, client });
      this.send(client, { type: 'exec.request', execId, order });
    });
  }

  // ---- internals ----

  /** Browsers always send Origin; only extensions (chrome-extension://) or non-browser clients may connect. */
  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || origin.startsWith('chrome-extension://');
  }

  /** Client IP (Cloudflare's header when behind its proxy). */
  private clientIp(req: IncomingMessage): string {
    const cf = req.headers['cf-connecting-ip'];
    if (this.opts.trustProxy && typeof cf === 'string' && cf) return cf;
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** Registers a new socket; it must send a valid hello before anything else. */
  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const burst = this.limits.messagesPerSecond * 2;
    const client: Client = { ws, ip: this.clientIp(req), userId: null, viewed: new Set(), tokens: burst, refilledAt: this.now() };
    this.clients.add(client);
    ws.on('message', (raw) => void this.onMessage(client, raw.toString()));
    ws.on('close', () => this.onClose(client));
  }

  /** Spends one message from the client's rate budget; false when it is exhausted. */
  private allow(client: Client): boolean {
    const now = this.now();
    const burst = this.limits.messagesPerSecond * 2;
    client.tokens = Math.min(burst, client.tokens + ((now - client.refilledAt) / 1000) * this.limits.messagesPerSecond);
    client.refilledAt = now;
    if (client.tokens < 1) return false;
    client.tokens -= 1;
    return true;
  }

  /** Parses and dispatches one client message. */
  private async onMessage(client: Client, raw: string): Promise<void> {
    if (!this.allow(client)) {
      client.ws.close(4008, 'Too many requests');
      return;
    }
    let msg: ClientMessage;
    try {
      msg = ClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      this.send(client, { type: 'error', message: 'Malformed message' });
      return;
    }
    if (client.userId === null) {
      if (msg.type !== 'hello') {
        client.ws.close(4001, 'Log in first');
        return;
      }
      this.login(client, msg.token, msg.executor, msg.create);
      return;
    }
    await this.dispatch(client, client.userId, msg);
  }

  /** Authenticates (creating the account if asked and allowed), then sends the welcome snapshot. */
  private login(client: Client, secret: string, executor: boolean, create: boolean): void {
    let account: Account;
    try {
      const allowCreate = create && this.mayCreateAccount(client.ip);
      const res = this.requireAccounts().login(secret, allowCreate);
      if (res.created) this.countCreated(client.ip);
      account = res.account;
    } catch (err) {
      // An unknown key with create requested only fails when this network hit its account-creation limit.
      const limited = create && err instanceof AuthError && err.message === 'Unknown account key';
      client.ws.close(4001, limited ? 'Too many new accounts from this network, try later' : 'Invalid account key');
      if (!(err instanceof AuthError)) this.log(`login failed: ${String(err)}`);
      return;
    }
    client.userId = account.id;
    this.refreshOrderMints(account.id);
    if (executor) this.setExecutor(client, account.id);
    const orders = this.requireEngine().listOrders(account.id);
    const ticks = this.requireEngine().latestTicks().filter((t) => this.wants(client, t.mint));
    this.send(client, { type: 'welcome', account: accountView(account), orders, ticks });
  }

  /** True when `ip` is still under its hourly account-creation limit. */
  private mayCreateAccount(ip: string): boolean {
    const entry = this.created.get(ip);
    if (!entry || this.now() - entry.since > 3_600_000) return true;
    return entry.count < this.limits.accountsPerIpPerHour;
  }

  /** Records an account creation for `ip`. */
  private countCreated(ip: string): void {
    const entry = this.created.get(ip);
    if (!entry || this.now() - entry.since > 3_600_000) this.created.set(ip, { count: 1, since: this.now() });
    else entry.count++;
  }

  /** Handles a logged-in client's command. */
  private async dispatch(client: Client, userId: string, msg: ClientMessage): Promise<void> {
    const engine = this.requireEngine();
    switch (msg.type) {
      case 'order.create':
        return this.reply(client, msg.reqId, () => engine.createOrder(userId, msg.order));
      case 'order.cancel':
        return this.reply(client, msg.reqId, async () => engine.cancelOrder(msg.id, undefined, userId));
      case 'order.list':
        return this.reply(client, msg.reqId, async () => engine.listOrders(userId));
      case 'wallet.holds':
        return this.reply(client, msg.reqId, async () => ({ holds: await engine.holds(userId, msg.mint) }));
      case 'price.watch':
        return this.reply(client, msg.reqId, () => {
          if (!client.viewed.has(msg.mint) && client.viewed.size >= this.limits.viewedTokens) {
            const oldest = client.viewed.values().next().value as string;
            client.viewed.delete(oldest); // keep the most recent tokens the user looked at
          }
          client.viewed.add(msg.mint);
          return engine.viewMint(msg.mint);
        });
      case 'token.info':
        return this.reply(client, msg.reqId, () => {
          if (!this.tokenInfo) throw new FomoError('Token info is not available on this server');
          return this.tokenInfo.getInfo(msg.mint);
        });
      case 'wallets.set':
        return this.reply(client, msg.reqId, async () => {
          const account = this.requireAccounts().setWallets(userId, msg.wallets);
          this.confirmers?.invalidate(userId);
          return accountView(account);
        });
      case 'account.info':
        return this.reply(client, msg.reqId, async () => {
          const wallets = this.requireAccounts().wallets(userId);
          return { id: userId, wallets };
        });
      case 'account.delete':
        await this.reply(client, msg.reqId, async () => {
          const orders = engine.deleteUserOrders(userId);
          this.requireAccounts().delete(userId);
          this.confirmers?.invalidate(userId);
          this.log(`account ${userId.slice(0, 8)} deleted (${orders} orders)`);
          return { deleted: true };
        });
        for (const c of this.clients) if (c.userId === userId) c.ws.close(4003, 'Account deleted');
        return;
      case 'exec.result': {
        const p = this.pending.get(msg.execId);
        this.log(`exec result ${userId.slice(0, 8)}: ${msg.result.ok ? msg.result.detail : `${msg.result.kind}: ${msg.result.message}`}`);
        if (p && p.client === client) this.settle(msg.execId, p, msg.result);
        return;
      }
      case 'hello':
      case 'pong':
        return;
    }
  }

  /** Runs a command and sends {ok,data} or {ok:false,error} back with the request id. */
  private async reply(client: Client, reqId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      this.send(client, { type: 'reply', reqId, ok: true, data: await fn() });
    } catch (err) {
      const error = err instanceof FomoError ? err.message : 'Internal error';
      if (!(err instanceof FomoError)) this.log(`command failed: ${String(err)}`);
      this.send(client, { type: 'reply', reqId, ok: false, error });
    }
  }

  /** Whether a client should receive ticks for `mint`: it is viewing it or its account has orders on it. */
  private wants(client: Client, mint: string): boolean {
    if (client.userId === null) return false;
    return client.viewed.has(mint) || (this.orderMints.get(client.userId)?.has(mint) ?? false);
  }

  /** Recomputes the tokens an account has active orders on. */
  private refreshOrderMints(userId: string): void {
    const engine = this.engine;
    if (!engine) return;
    this.orderMints.set(userId, new Set(engine.listOrders(userId).filter(isActive).map((o) => o.mint)));
  }

  /** Makes `client` its account's executor (newest connection wins) and wakes the engine for that account. */
  private setExecutor(client: Client, userId: string): void {
    this.executors.set(userId, client);
    this.log(`executor connected ${userId.slice(0, 8)}`);
    for (const cb of this.readyCbs) cb(userId);
  }

  /** Cleans up a closed socket; in-flight trades on it resolve as 'unknown'. */
  private onClose(client: Client): void {
    this.clients.delete(client);
    if (client.userId && this.executors.get(client.userId) === client) {
      this.executors.delete(client.userId);
      this.log(`executor disconnected ${client.userId.slice(0, 8)}`);
    }
    for (const [id, p] of this.pending) {
      if (p.client === client) this.settle(id, p, { ok: false, kind: 'unknown', message: 'Extension disconnected mid-trade' });
    }
  }

  /** Resolves a pending execution exactly once. */
  private settle(execId: string, p: PendingExec, result: ExecutionResult): void {
    clearTimeout(p.timer);
    this.pending.delete(execId);
    p.resolve(result);
  }

  /** Returns the attached engine or throws. */
  private requireEngine(): OrderEngine {
    if (!this.engine) throw new FomoError('Gateway has no engine attached');
    return this.engine;
  }

  /** Returns the attached account service or throws. */
  private requireAccounts(): AccountService {
    if (!this.accounts) throw new FomoError('Gateway has no account service attached');
    return this.accounts;
  }

  /** Sends JSON to every logged-in client. */
  private broadcast(payload: { type: string }): void {
    for (const c of this.clients) if (c.userId !== null) this.send(c, payload);
  }

  /** Sends JSON to one client if its socket is open. */
  private send(client: Client, payload: object): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(payload));
  }
}

