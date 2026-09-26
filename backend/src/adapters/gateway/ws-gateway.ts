/**
 * @file ws-gateway.ts
 * @description Local WebSocket server the Chrome extension connects to. Authenticates clients with a
 *              pairing token, relays order commands to the engine, broadcasts order/price events, and
 *              acts as the TradeExecutorPort by sending trades to the connected extension.
 * @author Reborn1987
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { FomoError } from '../../core/errors.js';
import type { Order } from '../../core/orders/order.js';
import type { EngineEvent, OrderEngine } from '../../core/orders/order-engine.js';
import type { TokenInfoService } from '../../core/tokens/token-info-service.js';
import type { PriceTick } from '../../ports/price-feed.js';
import { TradeExecutorPort, type ExecutionResult } from '../../ports/trade-executor.js';
import { ClientMessageSchema, type ClientMessage } from './protocol.js';

/** Gateway tuning. */
export interface GatewayOptions {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  /** How long to wait for the extension to report a trade result. */
  readonly execTimeoutMs: number;
  /** Min interval between price broadcasts per mint. */
  readonly tickThrottleMs: number;
  /** App-level keepalive (keeps the MV3 service worker alive). */
  readonly pingIntervalMs: number;
}

/** Per-connection state. */
interface Client {
  readonly ws: WebSocket;
  authed: boolean;
}

/** An execution awaiting the extension's answer. */
interface PendingExec {
  readonly resolve: (r: ExecutionResult) => void;
  readonly timer: NodeJS.Timeout;
  readonly client: Client;
}

/** Constant-time token comparison. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WsGateway extends TradeExecutorPort {
  private wss: WebSocketServer | null = null;
  private engine: OrderEngine | null = null;
  private tokenInfo: TokenInfoService | null = null;
  private readonly clients = new Set<Client>();
  private executor: Client | null = null;
  private readonly pending = new Map<string, PendingExec>();
  private readonly lastTickSent = new Map<string, number>();
  private readyCb: (() => void) | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  /** @param opts server options @param log logger for connection events */
  constructor(private readonly opts: GatewayOptions, private readonly log: (msg: string) => void) {
    super();
  }

  /** Wires the engine (engine and gateway depend on each other; set after both exist). */
  attach(engine: OrderEngine, tokenInfo: TokenInfoService | null = null): void {
    this.engine = engine;
    this.tokenInfo = tokenInfo;
  }

  /** Starts listening. Resolves once the port is bound. */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host,
        port: this.opts.port,
        verifyClient: ({ req }: { req: IncomingMessage }) => this.originAllowed(req),
      });
      wss.once('listening', () => resolve());
      wss.once('error', reject);
      wss.on('connection', (ws) => this.onConnection(ws));
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

  /** Engine event sink: broadcasts order changes and throttled price ticks. */
  handleEngineEvent(e: EngineEvent): void {
    if (e.type === 'order') {
      this.broadcast({ type: 'order', order: e.order });
      return;
    }
    const last = this.lastTickSent.get(e.tick.mint) ?? 0;
    if (e.tick.receivedAt - last < this.opts.tickThrottleMs) return;
    this.lastTickSent.set(e.tick.mint, e.tick.receivedAt);
    this.broadcast({ type: 'tick', tick: e.tick });
  }

  // ---- TradeExecutorPort ----

  /** Ready when an authenticated executor connection is open. */
  isReady(): boolean {
    return this.executor !== null;
  }

  /** Stores the readiness callback. */
  onReady(cb: () => void): void {
    this.readyCb = cb;
  }

  /** Sends the trade to the extension and waits for its result (or times out as 'timeout'). */
  execute(order: Order): Promise<ExecutionResult> {
    const client = this.executor;
    if (!client) return Promise.resolve({ ok: false, kind: 'ui_error', message: 'No extension connected' });
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

  /** Browsers always send Origin; only our extension (chrome-extension://) or non-browser clients may connect. */
  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || origin.startsWith('chrome-extension://');
  }

  /** Registers a new socket; it must send a valid hello before anything else. */
  private onConnection(ws: WebSocket): void {
    const client: Client = { ws, authed: false };
    this.clients.add(client);
    ws.on('message', (raw) => void this.onMessage(client, raw.toString()));
    ws.on('close', () => this.onClose(client));
  }

  /** Parses and dispatches one client message. */
  private async onMessage(client: Client, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = ClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      this.send(client, { type: 'error', message: 'Malformed message' });
      return;
    }
    if (!client.authed) {
      if (msg.type !== 'hello' || !tokenMatches(msg.token, this.opts.token)) {
        client.ws.close(4001, 'Invalid pairing token');
        return;
      }
      client.authed = true;
      if (msg.executor) this.setExecutor(client);
      this.send(client, { type: 'welcome', orders: this.requireEngine().listOrders(), ticks: this.requireEngine().latestTicks() });
      return;
    }
    await this.dispatch(client, msg);
  }

  /** Handles an authenticated client's command. */
  private async dispatch(client: Client, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'order.create':
        return this.reply(client, msg.reqId, () => this.requireEngine().createOrder(msg.order));
      case 'order.cancel':
        return this.reply(client, msg.reqId, async () => this.requireEngine().cancelOrder(msg.id));
      case 'order.list':
        return this.reply(client, msg.reqId, async () => this.requireEngine().listOrders());
      case 'price.watch':
        return this.reply(client, msg.reqId, () => this.requireEngine().viewMint(msg.mint));
      case 'token.info':
        return this.reply(client, msg.reqId, () => {
          if (!this.tokenInfo) throw new FomoError('Token info is not available on this server');
          return this.tokenInfo.getInfo(msg.mint);
        });
      case 'exec.result': {
        const p = this.pending.get(msg.execId);
        this.log(`exec result: ${msg.result.ok ? msg.result.detail : `${msg.result.kind}: ${msg.result.message}`}`);
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

  /** Makes `client` the executor (newest connection wins) and wakes the engine. */
  private setExecutor(client: Client): void {
    this.executor = client;
    this.log('extension executor connected');
    this.readyCb?.();
  }

  /** Cleans up a closed socket; in-flight trades on it resolve as 'unknown'. */
  private onClose(client: Client): void {
    this.clients.delete(client);
    if (this.executor === client) {
      this.executor = null;
      this.log('extension executor disconnected');
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

  /** Sends JSON to every authenticated client. */
  private broadcast(payload: { type: string; order?: Order; tick?: PriceTick }): void {
    for (const c of this.clients) if (c.authed) this.send(c, payload);
  }

  /** Sends JSON to one client if its socket is open. */
  private send(client: Client, payload: object): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(payload));
  }
}
