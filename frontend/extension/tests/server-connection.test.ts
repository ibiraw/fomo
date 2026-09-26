/**
 * @file server-connection.test.ts
 * @description Tests for ServerConnection with a fake socket: handshake, replies, events, reconnect, bad token.
 * @author Reborn1987
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerCommandError, ServerConnection, type ConnectionHandlers, type SocketLike } from '../lib/server-connection';
import type { ExecutionResult, Order } from '../lib/types';

/** Fake socket recording sent frames; test drives server messages via recv(). */
class FakeSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string): void { this.sent.push(JSON.parse(d) as Record<string, unknown>); }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  recv(m: object): void { this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent); }
  drop(code = 1006): void { this.readyState = 3; this.onclose?.({ code } as CloseEvent); }
}

const ORDER = { id: 'o1', mint: 'M', side: 'buy', status: 'open', createdAt: 1 } as unknown as Order;

let sockets: FakeSocket[];
let statuses: string[];
let handlers: ConnectionHandlers & { onExecute: ReturnType<typeof vi.fn> };
let conn: ServerConnection;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  statuses = [];
  handlers = {
    onStatus: (s) => statuses.push(s),
    onSnapshot: vi.fn(),
    onOrder: vi.fn(),
    onTick: vi.fn(),
    onBilling: vi.fn(),
    onExecute: vi.fn(async (): Promise<ExecutionResult> => ({ ok: true, detail: 'done' })),
  };
  conn = new ServerConnection((url) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s as unknown as SocketLike;
  }, handlers);
});

afterEach(() => vi.useRealTimers());

/** Starts, opens and welcomes a connection. */
function connectOk(): FakeSocket {
  conn.start('ws://x', 'tok');
  const s = sockets.at(-1)!;
  s.open();
  s.recv({ type: 'welcome', orders: [ORDER], ticks: [] });
  return s;
}

describe('ServerConnection', () => {
  it('reports no_token without connecting', () => {
    conn.start('ws://x', null);
    expect(conn.getStatus()).toBe('no_token');
    expect(sockets).toHaveLength(0);
  });

  it('sends hello as executor and becomes connected on welcome', () => {
    const s = connectOk();
    expect(s.sent[0]).toEqual({ type: 'hello', token: 'tok', executor: true, create: true });
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(handlers.onSnapshot).toHaveBeenCalledWith([ORDER], [], null);
  });

  it('resolves and rejects requests from replies', async () => {
    const s = connectOk();
    const ok = conn.request('order.list', {});
    s.recv({ type: 'reply', reqId: s.sent[1]!.reqId, ok: true, data: [1] });
    await expect(ok).resolves.toEqual([1]);
    const bad = conn.request('order.create', { order: {} });
    s.recv({ type: 'reply', reqId: s.sent[2]!.reqId, ok: false, error: 'Minimum trade is $2' });
    await expect(bad).rejects.toThrow(ServerCommandError);
  });

  it('times out unanswered requests and rejects when not connected', async () => {
    connectOk();
    const p = conn.request('order.list', {});
    vi.advanceTimersByTime(15_000);
    await expect(p).rejects.toThrow(/in time/);
    conn.stop();
    await expect(conn.request('order.list', {})).rejects.toThrow(/Not connected/);
  });

  it('forwards order and tick events, answers pings, ignores junk', () => {
    const s = connectOk();
    s.recv({ type: 'order', order: ORDER });
    s.recv({ type: 'tick', tick: { mint: 'M' } });
    s.recv({ type: 'ping' });
    s.recv({ type: 'error', message: 'x' });
    s.onmessage?.({ data: 'not json' } as MessageEvent);
    expect(handlers.onOrder).toHaveBeenCalledWith(ORDER);
    expect(handlers.onTick).toHaveBeenCalled();
    expect(s.sent.at(-1)).toEqual({ type: 'pong' });
  });

  it('executes trades and reports the result', async () => {
    const s = connectOk();
    s.recv({ type: 'exec.request', execId: 'e1', order: ORDER });
    await vi.waitFor(() => expect(s.sent.at(-1)).toEqual({ type: 'exec.result', execId: 'e1', result: { ok: true, detail: 'done' } }));
  });

  it('reconnects with backoff after a drop and rejects in-flight requests', async () => {
    const s = connectOk();
    const p = conn.request('order.list', {});
    s.drop();
    await expect(p).rejects.toThrow(/lost/);
    expect(conn.getStatus()).toBe('disconnected');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('stops on a rejected account key', () => {
    const s = connectOk();
    s.drop(4001);
    expect(conn.getStatus()).toBe('bad_token');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('stops when the account was deleted, and passes the account from the welcome', () => {
    conn.start('ws://x', 'tok');
    const s = sockets[0]!;
    s.open();
    s.recv({ type: 'welcome', orders: [], ticks: [], account: { id: 'a1', wallets: { solana: null, evm: null } } });
    expect(handlers.onSnapshot).toHaveBeenCalledWith([], [], { id: 'a1', wallets: { solana: null, evm: null } });
    expect(handlers.onBilling).toHaveBeenLastCalledWith(null);
    s.recv({ type: 'billing', status: { unlocked: true, freeOrdersLeft: 0, creditUsd: 50, priceUsd: 50, tokenPriceUsd: 35 } });
    expect(handlers.onBilling).toHaveBeenLastCalledWith(expect.objectContaining({ unlocked: true }));
    s.drop(4003);
    expect(conn.getStatus()).toBe('deleted');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('ensure() restarts only when down', () => {
    connectOk();
    conn.ensure('ws://x', 'tok');
    expect(sockets).toHaveLength(1);
    conn.stop();
    conn.ensure('ws://x', 'tok');
    expect(sockets).toHaveLength(2);
  });
});
