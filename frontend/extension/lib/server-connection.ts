/**
 * @file server-connection.ts
 * @description WebSocket client for the local FOMO order server: pairing handshake, auto-reconnect,
 *              request/reply, and dispatch of order/price/execution events.
 * @author Reborn1987
 */

import type { AccountView } from './account';
import type { ExecutionResult, Order, PriceTick } from './types';

/** `bad_token`: the server rejected the account key; `deleted`: the account was deleted from another device. */
export type ConnectionStatus = 'no_token' | 'connecting' | 'connected' | 'disconnected' | 'bad_token' | 'deleted';

/** Callbacks the connection reports to. */
export interface ConnectionHandlers {
  onStatus(status: ConnectionStatus): void;
  onSnapshot(orders: Order[], ticks: PriceTick[], account: AccountView | null): void;
  onOrder(order: Order): void;
  onTick(tick: PriceTick): void;
  /** Execute a trade and resolve with its result. */
  onExecute(order: Order): Promise<ExecutionResult>;
}

/** Minimal WebSocket surface (lets tests inject a fake). */
export type SocketLike = Pick<WebSocket, 'readyState' | 'onopen' | 'onclose' | 'onmessage' | 'onerror' | 'send' | 'close'>;

export type SocketFactory = (url: string) => SocketLike;

type ServerMessage =
  | { type: 'welcome'; orders: Order[]; ticks: PriceTick[]; account?: AccountView }
  | { type: 'reply'; reqId: string; ok: true; data: unknown }
  | { type: 'reply'; reqId: string; ok: false; error: string }
  | { type: 'order'; order: Order }
  | { type: 'tick'; tick: PriceTick }
  | { type: 'exec.request'; execId: string; order: Order }
  | { type: 'ping' }
  | { type: 'error'; message: string };

const OPEN = 1;
const BAD_TOKEN_CODE = 4001;
const DELETED_CODE = 4003;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Error returned by the server for a command (validation, unsupported token, ...). */
export class ServerCommandError extends Error {}

export class ServerConnection {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'disconnected';
  private backoff = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  /** @param factory creates sockets @param handlers event sinks */
  constructor(private readonly factory: SocketFactory, private readonly handlers: ConnectionHandlers) {}

  /** Current status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** (Re)starts the connection with the given settings. */
  start(url: string, token: string | null): void {
    this.stop();
    if (!token) return this.setStatus('no_token');
    this.stopped = false;
    this.backoff = MIN_BACKOFF_MS;
    this.open(url, token);
  }

  /** Reconnects now if the socket is down (called by a keepalive alarm after worker restarts). */
  ensure(url: string, token: string | null): void {
    if (this.stopped || this.status === 'disconnected') this.start(url, token);
  }

  /** Closes the socket and stops reconnecting. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
    this.failPending('Connection closed');
  }

  /** Sends a command and resolves with the server's reply data (rejects with ServerCommandError). */
  request(
    type: 'order.create' | 'order.cancel' | 'order.list' | 'token.info' | 'price.watch' | 'wallet.holds' | 'wallets.set' | 'account.info' | 'account.delete',
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const s = this.socket;
    if (!s || this.status !== 'connected') return Promise.reject(new ServerCommandError('Not connected to the auto fomo server'));
    const reqId = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new ServerCommandError('Server did not answer in time'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
      s.send(JSON.stringify({ type, reqId, ...body }));
    });
  }

  /** Opens a socket and wires its events. */
  private open(url: string, token: string): void {
    this.setStatus('connecting');
    const s = this.factory(url);
    this.socket = s;
    // create: the key was made by this extension, so an unknown key is a new account (not a typo).
    s.onopen = () => s.send(JSON.stringify({ type: 'hello', token, executor: true, create: true }));
    s.onmessage = (ev) => this.onMessage(s, String(ev.data));
    s.onerror = () => undefined; // onclose follows and handles reconnect
    s.onclose = (ev) => {
      if (this.socket !== s) return;
      this.socket = null;
      this.failPending('Connection lost');
      if (ev.code === BAD_TOKEN_CODE || ev.code === DELETED_CODE) {
        this.stopped = true;
        return this.setStatus(ev.code === DELETED_CODE ? 'deleted' : 'bad_token');
      }
      this.setStatus('disconnected');
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.open(url, token), this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }
    };
  }

  /** Dispatches a server message. */
  private onMessage(s: SocketLike, raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.backoff = MIN_BACKOFF_MS;
        this.setStatus('connected');
        return this.handlers.onSnapshot(msg.orders, msg.ticks, msg.account ?? null);
      case 'reply': {
        const p = this.pending.get(msg.reqId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.reqId);
        return msg.ok ? p.resolve(msg.data) : p.reject(new ServerCommandError(msg.error));
      }
      case 'order':
        return this.handlers.onOrder(msg.order);
      case 'tick':
        return this.handlers.onTick(msg.tick);
      case 'exec.request':
        void this.handlers.onExecute(msg.order).then((result) => {
          if (s.readyState === OPEN) s.send(JSON.stringify({ type: 'exec.result', execId: msg.execId, result }));
        });
        return;
      case 'ping':
        if (s.readyState === OPEN) s.send(JSON.stringify({ type: 'pong' }));
        return;
      case 'error':
        return;
    }
  }

  /** Rejects all in-flight requests. */
  private failPending(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new ServerCommandError(reason));
      this.pending.delete(id);
    }
  }

  /** Updates and reports status. */
  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.handlers.onStatus(s);
  }
}
