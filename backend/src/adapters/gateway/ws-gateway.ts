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
import type { BillingService } from '../../core/billing/billing-service.js';
import { versionOf, type Feature, type ReleaseService } from '../../core/releases/releases.js';
import type { LaunchpadService } from '../../core/tokens/launchpad-service.js';
import { AuthError, FomoError } from '../../core/errors.js';
import type { Order, OrderStatus } from '../../core/orders/order.js';
import type { EngineEvent, OrderEngine } from '../../core/orders/order-engine.js';
import type { TokenInfoService } from '../../core/tokens/token-info-service.js';
import type { Account } from '../../ports/account-store.js';
import type { LayoutReport } from '../../core/monitoring/layout-report.js';
import { orderEntry } from '../../core/monitoring/describe.js';
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
  /** Monitoring sink for account events (new, deleted, wallets, payment claims). */
  readonly onActivity?: (kind: 'account' | 'payment' | 'order', text: string) => void;
  /** fomo self-check reports: layout broken / working again, fomo shipped a new version (with a layout snapshot). */
  readonly onLayout?: (report: LayoutReport) => void;
  /** How long a paused (layout-broken) executor waits before trying again on its own. Default 10 min. */
  readonly layoutRetryMs?: number;
  readonly limits?: GatewayLimits;
  /** A connection that hasn't logged in within this time is closed (default 10 s). */
  readonly helloTimeoutMs?: number;
}

/** Default wait before a layout-paused executor retries by itself. Nothing is clicked when the layout is wrong, so
 * retrying is safe. */
export const DEFAULT_LAYOUT_RETRY_MS = 10 * 60_000;

/** Default login deadline for new connections. */
export const DEFAULT_HELLO_TIMEOUT_MS = 10_000;

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
  /** Closes the connection if it hasn't logged in in time; cleared on login. */
  helloTimer: NodeJS.Timeout | null;
  /** Logged in as a trade executor (an extension that can click Buy/Sell). */
  executor: boolean;
  /** Paused because fomo's layout wasn't recognised (until a check passes, the settings change, or the retry). */
  layoutPausedUntil: number | null;
  /** The pending automatic retry (one per connection, however many failures are reported). */
  layoutTimer: NodeJS.Timeout | null;
  /** Last spot-trade report (text + time), so a repeat or a flood can't spam the monitoring chat. */
  lastSpot: { readonly text: string; readonly at: number } | null;
}

/**
 * The trade part of fomo's toast: whitespace squeezed and the toast's own relative time ("Just now", "2m ago"), which
 * textContent glues onto the token name ("Buying $25.00 QCATJust now"), removed.
 */
export function spotText(detail: string): string {
  return detail
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(?:just now|\d+\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\s*ago)$/i, '')
    .trim();
}

/** A spot sell measured against the position shown just before it. */
export interface SpotSell {
  readonly all: boolean;
  readonly soldPct: number;
  readonly usd: number;
  readonly pnlPct: number;
}

/**
 * Icon, who and action line of a spot trade (bold type in Telegram):
 *   ✅ **SPOT BUY** on fomo: Buying $25.00 QCAT
 *   ❌ **SELL ALL** on fomo: Selling 211.3K QCAT for $48.20 ⬆️ 12.4%
 *   ❌ **PARTIAL SELL** (45%) on fomo: Selling 95K QCAT for $21.70 ⬇️ 8.1%
 */
export function spotLine(side: 'buy' | 'sell', text: string, sell: SpotSell | null, who: string): [string, string, string] {
  if (side === 'buy') return ['✅', who, `**SPOT BUY** on fomo: ${text}`];
  if (!sell) return ['❌', who, `**SPOT SELL** on fomo: ${text}`];
  const kind = sell.all ? '**SELL ALL**' : `**PARTIAL SELL** (${sell.soldPct}%)`;
  const pnl = `${sell.pnlPct >= 0 ? '⬆️' : '⬇️'} ${Math.abs(sell.pnlPct).toFixed(1)}%`;
  return ['❌', who, `${kind} on fomo: ${text} for $${sell.usd.toFixed(2)} ${pnl}`];
}

/** Spot-trade reports: at most one per connection per this window, and the same text only once a minute. */
const SPOT_MIN_GAP_MS = 3_000;
const SPOT_REPEAT_MS = 60_000;

/** An execution awaiting the extension's answer. */
interface PendingExec {
  readonly resolve: (r: ExecutionResult) => void;
  readonly timer: NodeJS.Timeout;
  readonly client: Client;
}

/** Statuses whose token prices an account needs. */
const ACTIVE_STATUSES: readonly OrderStatus[] = ['open', 'triggered', 'executing'];

/** What a client sees about its account. */
/** Account label for monitoring: short id plus the fomo username once known ("LM-7K3Q2P (@name)"). */
const label = (a: Account): string => (a.fomoUsername ? `${a.shortId} (@${a.fomoUsername})` : a.shortId);

const accountView = (a: Account) => ({ id: a.id, shortId: a.shortId, wallets: a.wallets, fomoUsername: a.fomoUsername, fomoUserId: a.fomoUserId });

export class WsGateway extends TradeExecutorPort {
  private wss: WebSocketServer | null = null;
  private engine: OrderEngine | null = null;
  private tokenInfo: TokenInfoService | null = null;
  private accounts: AccountService | null = null;
  private confirmers: WalletConfirmers | null = null;
  private billing: BillingService | null = null;
  /** Which version and features each account sees (null: everything, e.g. in tests). */
  private releases: ReleaseService | null = null;
  /** v1.8: where tokens were launched (null: not available on this server). */
  private launchpads: LaunchpadService | null = null;
  /** fomo page-layout overrides sent to extensions (null: they use their built-ins). */
  private fomoDom: unknown = null;
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

  /**
   * Wires the core services (they and the gateway depend on each other; set after all exist).
   * Without `billing` the server runs without a paywall.
   */
  attach(engine: OrderEngine, accounts: AccountService, confirmers: WalletConfirmers, tokenInfo: TokenInfoService | null = null, billing: BillingService | null = null): void {
    this.engine = engine;
    this.accounts = accounts;
    this.confirmers = confirmers;
    this.tokenInfo = tokenInfo;
    this.billing = billing;
  }

  /**
   * Sets the fomo page-layout overrides (null: none) and pushes them to every logged-in connection; new connections
   * get them in the welcome. Extensions apply them within seconds, so a fomo redesign needs no store update.
   */
  setFomoDom(overrides: unknown): void {
    this.fomoDom = overrides ?? null;
    for (const c of this.clients) if (c.userId !== null) this.send(c, { type: 'fomoDom', overrides: this.fomoDom });
    // New settings: every layout-paused account tries again (nothing is clicked if it's still wrong).
    for (const c of this.clients) if (c.layoutPausedUntil !== null && c.userId) this.resumeLayout(c, c.userId);
  }

  /** Pauses an executor's trades after a layout miss and schedules the automatic retry. */
  private pauseLayout(client: Client, userId: string): boolean {
    const wasPaused = client.layoutPausedUntil !== null;
    const retryMs = this.opts.layoutRetryMs ?? DEFAULT_LAYOUT_RETRY_MS;
    client.layoutPausedUntil = this.now() + retryMs;
    if (client.layoutTimer) clearTimeout(client.layoutTimer);
    client.layoutTimer = setTimeout(() => {
      client.layoutTimer = null;
      if (client.layoutPausedUntil !== null) this.resumeLayout(client, userId);
    }, retryMs);
    client.layoutTimer.unref?.();
    return !wasPaused;
  }

  /** Lifts a layout pause and lets queued trades run. True when it was paused. */
  private resumeLayout(client: Client, userId: string): boolean {
    if (client.layoutPausedUntil === null) return false;
    client.layoutPausedUntil = null;
    if (client.layoutTimer) clearTimeout(client.layoutTimer);
    client.layoutTimer = null;
    if (this.executors.get(userId) === client) for (const cb of this.readyCbs) cb(userId);
    return true;
  }

  /** Sets the staged-release rules; each login gets its account's version and features. */
  setReleases(releases: ReleaseService): void {
    this.releases = releases;
  }

  /** Sets the launchpad lookup (v1.8). */
  setLaunchpads(launchpads: LaunchpadService): void {
    this.launchpads = launchpads;
  }

  /** Throws unless the account's version has the feature (always allowed when no release rules are set). */
  private requireFeature(userId: string, feature: Feature): void {
    const release = this.releaseFor(userId);
    if (release && !release.features.includes(feature)) throw new FomoError(`This arrives in limit v${versionOf(feature)}`);
  }

  /** Version and features for an account (null when no release rules are set: the extension shows everything). */
  private releaseFor(userId: string) {
    if (!this.releases) return null;
    let shortId = '';
    try {
      shortId = this.requireAccounts().get(userId).shortId;
    } catch (err) {
      if (!(err instanceof AuthError)) throw err; // deleted meanwhile: it gets the public version
    }
    return this.releases.viewFor({ id: userId, shortId });
  }

  /**
   * The access file changed: every logged-in connection gets its (possibly new) version and features, and its billing
   * status (free-until dates may have changed).
   */
  pushAccess(): void {
    for (const c of this.clients) {
      if (c.userId === null) continue;
      this.send(c, { type: 'release', release: this.releaseFor(c.userId) });
      if (this.billing) this.send(c, { type: 'billing', status: this.billing.status(c.userId) });
    }
  }

  /** Billing sink: sends the account's new unlock status to its open connections. */
  pushBilling(userId: string): void {
    if (!this.billing) return;
    const status = this.billing.status(userId);
    for (const c of this.clients) if (c.userId === userId) this.send(c, { type: 'billing', status });
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
      this.pingTimer = setInterval(() => {
        this.broadcast({ type: 'ping' });
        this.prune();
      }, this.opts.pingIntervalMs);
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
      this.pushBilling(e.order.userId); // free orders left may have changed
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
    const c = this.executors.get(userId);
    if (!c) return false;
    if (c.layoutPausedUntil !== null && this.now() < c.layoutPausedUntil) return false;
    return true;
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
    const client: Client = { ws, ip: this.clientIp(req), userId: null, viewed: new Set(), tokens: burst, refilledAt: this.now(), helloTimer: null, executor: false, layoutPausedUntil: null, layoutTimer: null, lastSpot: null };
    client.helloTimer = setTimeout(() => {
      client.helloTimer = null;
      if (client.userId === null) ws.close(4001, 'Log in first');
    }, this.opts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    this.clients.add(client);
    ws.on('message', (raw) => void this.onMessage(client, raw.toString()));
    // Protocol errors (e.g. a frame over maxPayload) are emitted here; ws closes the socket itself afterwards.
    // Without a listener Node treats them as unhandled and the whole server crashes.
    ws.on('error', (err) => this.log(`socket error from ${client.ip}: ${err.message}`));
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
      if (res.created) {
        this.countCreated(client.ip);
        this.opts.onActivity?.('account', `new account ${res.account.shortId}`);
      }
      account = res.account;
    } catch (err) {
      // An unknown key with create requested only fails when this network hit its account-creation limit.
      const limited = create && err instanceof AuthError && err.message === 'Unknown account key';
      client.ws.close(4001, limited ? 'Too many new accounts from this network, try later' : 'Invalid account key');
      if (!(err instanceof AuthError)) this.log(`login failed: ${String(err)}`);
      return;
    }
    client.userId = account.id;
    if (client.helloTimer) clearTimeout(client.helloTimer);
    client.helloTimer = null;
    this.refreshOrderMints(account.id);
    if (executor) this.setExecutor(client, account.id);
    const orders = this.requireEngine().listOrders(account.id);
    const ticks = this.requireEngine().latestTicks().filter((t) => this.wants(client, t.mint));
    const billing = this.billing?.status(account.id) ?? null;
    this.send(client, { type: 'welcome', account: accountView(account), orders, ticks, billing, fomoDom: this.fomoDom, release: this.releaseFor(account.id) });
  }

  /**
   * Drops bookkeeping that would otherwise grow for as long as the server runs: account-creation counters older than
   * their hour, and throttle times of tokens that haven't ticked for 10 minutes.
   */
  prune(): void {
    const now = this.now();
    for (const [ip, e] of this.created) if (now - e.since > 3_600_000) this.created.delete(ip);
    for (const [mint, at] of this.lastTickSent) if (now - at > 10 * 60_000) this.lastTickSent.delete(mint);
  }

  /** Sizes of the gateway's bookkeeping maps (tests / diagnostics). */
  stats(): { clients: number; created: number; lastTickSent: number; orderMints: number } {
    return { clients: this.clients.size, created: this.created.size, lastTickSent: this.lastTickSent.size, orderMints: this.orderMints.size };
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
      case 'token.launchpad':
        return this.reply(client, msg.reqId, () => {
          this.requireFeature(userId, 'launchpad');
          if (!this.launchpads) throw new FomoError('Launchpad info is not available on this server');
          return this.launchpads.get(msg.mint);
        });
      case 'wallets.set':
        return this.reply(client, msg.reqId, async () => {
          const account = this.requireAccounts().setWallets(userId, msg.wallets);
          this.confirmers?.invalidate(userId);
          this.opts.onActivity?.('account', `${label(account)} wallets: SOL ${account.wallets.solana ?? '-'} · EVM ${account.wallets.evm ?? '-'}`);
          return accountView(account);
        });
      case 'profile.set':
        return this.reply(client, msg.reqId, async () => {
          const { account, changed } = this.requireAccounts().setFomoProfile(userId, { username: msg.fomoUsername, userId: msg.fomoUserId });
          if (changed) this.opts.onActivity?.('account', `${account.shortId} is @${account.fomoUsername ?? '?'} on fomo · fomo id ${account.fomoUserId ?? '?'}`);
          return accountView(account);
        });
      case 'account.info':
        return this.reply(client, msg.reqId, async () => {
          return accountView(this.requireAccounts().get(userId));
        });
      case 'billing.status':
        return this.reply(client, msg.reqId, async () => this.billing?.status(userId) ?? null);
      case 'billing.quote':
        return this.reply(client, msg.reqId, async () => {
          if (!this.billing) throw new FomoError('This server has no paywall');
          return this.billing.quote(userId);
        });
      case 'billing.claim':
        return this.reply(client, msg.reqId, async () => {
          if (!this.billing) throw new FomoError('This server has no paywall');
          const who = label(this.requireAccounts().get(userId));
          try {
            const status = this.billing.claim(userId, msg.tx);
            this.opts.onActivity?.('payment', `${who} claimed ${msg.tx.slice(0, 120)}`);
            return status;
          } catch (err) {
            this.opts.onActivity?.('payment', `${who} claim refused (${err instanceof Error ? err.message : String(err)}): ${msg.tx.slice(0, 120)}`);
            throw err;
          }
        });
      case 'account.delete':
        await this.reply(client, msg.reqId, async () => {
          const who = label(this.requireAccounts().get(userId));
          const orders = engine.closeUserOrders(userId);
          this.billing?.forget(userId);
          this.requireAccounts().delete(userId);
          this.confirmers?.invalidate(userId);
          this.log(`account ${userId.slice(0, 8)} deleted (${orders} open orders cancelled)`);
          this.opts.onActivity?.('account', `${who} deleted their account (${orders} open orders cancelled)`);
          return { deleted: true };
        });
        for (const c of this.clients) if (c.userId === userId) c.ws.close(4003, 'Account deleted');
        return;
      case 'exec.result': {
        const p = this.pending.get(msg.execId);
        this.log(`exec result ${userId.slice(0, 8)}: ${msg.result.ok ? msg.result.detail : `${msg.result.kind}: ${msg.result.message}`}`);
        if (!p || p.client !== client) return;
        // Pause before the engine sees the result, so it stops pumping this account's queue.
        if (!msg.result.ok && msg.result.kind === 'layout' && this.pauseLayout(client, userId)) {
          this.opts.onLayout?.({ account: this.requireAccounts().get(userId), ok: false, missing: [msg.result.message], newVersion: false, snapshot: null, paused: true });
        }
        this.settle(msg.execId, p, msg.result);
        return;
      }
      case 'trade.spot':
        return this.reply(client, msg.reqId, async () => {
          const now = this.now();
          const text = spotText(msg.detail);
          const last = client.lastSpot;
          const skip = last !== null && (now - last.at < SPOT_MIN_GAP_MS || (last.text === text && now - last.at < SPOT_REPEAT_MS));
          if (skip) return { logged: false };
          client.lastSpot = { text, at: now };
          this.opts.onActivity?.('order', orderEntry(...spotLine(msg.side, text, msg.sell ?? null, label(this.requireAccounts().get(userId))), msg.mint ?? null));
          return { logged: true };
        });
      case 'layout.status':
        return this.reply(client, msg.reqId, async () => {
          let paused: boolean | null = null;
          if (msg.ok === false && client.executor) paused = this.pauseLayout(client, userId) ? true : null;
          if (msg.ok === true && this.resumeLayout(client, userId)) paused = false;
          this.opts.onLayout?.({
            account: this.requireAccounts().get(userId), ok: msg.ok ?? null, missing: msg.missing, newVersion: msg.newVersion, snapshot: msg.snapshot ?? null, paused,
          });
          return { paused: client.layoutPausedUntil !== null };
        });
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
    this.orderMints.set(userId, new Set(engine.listOrders(userId, ACTIVE_STATUSES).map((o) => o.mint)));
  }

  /** Makes `client` its account's executor (newest connection wins) and wakes the engine for that account. */
  private setExecutor(client: Client, userId: string): void {
    client.executor = true;
    this.executors.set(userId, client);
    this.log(`executor connected ${userId.slice(0, 8)}`);
    for (const cb of this.readyCbs) cb(userId);
  }

  /** Cleans up a closed socket; in-flight trades on it resolve as 'unknown'. */
  private onClose(client: Client): void {
    if (client.helloTimer) clearTimeout(client.helloTimer);
    if (client.layoutTimer) clearTimeout(client.layoutTimer);
    this.clients.delete(client);
    // Last connection of this account gone: drop its token list (rebuilt on the next login).
    if (client.userId && ![...this.clients].some((c) => c.userId === client.userId)) this.orderMints.delete(client.userId);
    if (client.userId && this.executors.get(client.userId) === client) {
      this.executors.delete(client.userId);
      this.log(`executor disconnected ${client.userId.slice(0, 8)}`);
      // Same account on another device (e.g. PC and Mac): hand trades to the most recent one still connected.
      const other = [...this.clients].reverse().find((c) => c.userId === client.userId && c.executor);
      if (other) this.setExecutor(other, client.userId);
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

