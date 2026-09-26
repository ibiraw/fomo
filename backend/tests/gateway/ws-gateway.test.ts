/**
 * @file ws-gateway.test.ts
 * @description Tests for WsGateway over real sockets: auth, origin check, commands, execution, broadcasts.
 * @author Reborn1987
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { WsGateway } from '../../src/adapters/gateway/ws-gateway.js';
import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const TOKEN = 'test-token';
const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const ORDER = { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } };

type Msg = Record<string, unknown> & { type: string };

/** Test client that records every message and can wait for a matching one. */
class TestClient {
  readonly msgs: Msg[] = [];
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString()) as Msg));
    ws.on('close', (code) => (this.closeCode = code));
  }
  /** Sends a JSON message. */
  send(m: object): void { this.ws.send(JSON.stringify(m)); }
  /** Waits for the first message matching the predicate. */
  async next(pred: (m: Msg) => boolean): Promise<Msg> {
    let found: Msg | undefined;
    await vi.waitFor(() => { found = this.msgs.find(pred); expect(found).toBeDefined(); });
    return found as Msg;
  }
}

let gateway: WsGateway;
let feed: FakePriceFeed;
let store: SqliteOrderStoreAdapter;
const sockets: WebSocket[] = [];

/** Opens a socket (optionally with an Origin header) and waits for it to open. */
async function connect(origin?: string): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port()}`, origin ? { origin } : {});
  sockets.push(ws);
  const c = new TestClient(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return c;
}

/** Connects and authenticates. */
async function authed(executor: boolean): Promise<TestClient> {
  const c = await connect('chrome-extension://abc');
  c.send({ type: 'hello', token: TOKEN, executor });
  await c.next((m) => m.type === 'welcome');
  return c;
}

beforeEach(async () => {
  feed = new FakePriceFeed();
  store = new SqliteOrderStoreAdapter(':memory:');
  gateway = new WsGateway({ host: '127.0.0.1', port: 0, token: TOKEN, execTimeoutMs: 300, tickThrottleMs: 250, pingIntervalMs: 50 }, () => undefined);
  const engine = new OrderEngine(store, feed, gateway, (e) => gateway.handleEngineEvent(e), () => undefined);
  gateway.attach(engine);
  await gateway.listen();
  await engine.start();
});

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await gateway.close();
});

describe('WsGateway auth', () => {
  it('rejects browser pages from other origins', async () => {
    await expect(connect('https://evil.example')).rejects.toThrow(/401/);
  });

  it('closes connections with a wrong token', async () => {
    const c = await connect();
    c.send({ type: 'hello', token: 'wrong', executor: false });
    await vi.waitFor(() => expect(c.closeCode).toBe(4001));
  });

  it('closes unauthenticated clients that skip hello, and reports malformed JSON', async () => {
    const c = await connect();
    c.ws.send('not json');
    await c.next((m) => m.type === 'error');
    c.send({ type: 'order.list', reqId: '1' });
    await vi.waitFor(() => expect(c.closeCode).toBe(4001));
  });
});

describe('WsGateway commands', () => {
  it('creates, lists and cancels orders with replies', async () => {
    const c = await authed(false);
    c.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const created = await c.next((m) => m.type === 'reply' && m.reqId === 'a');
    expect(created.ok).toBe(true);
    const id = (created.data as { id: string }).id;
    c.send({ type: 'order.list', reqId: 'b' });
    expect(((await c.next((m) => m.reqId === 'b')).data as unknown[]).length).toBe(1);
    c.send({ type: 'order.cancel', reqId: 'c', id });
    expect((await c.next((m) => m.reqId === 'c')).ok).toBe(true);
    await c.next((m) => m.type === 'order' && (m.order as { status: string }).status === 'cancelled');
  });

  it('answers token.info, or explains when it is unavailable', async () => {
    const c = await authed(false);
    c.send({ type: 'token.info', reqId: 't1', mint: MINT });
    expect((await c.next((m) => m.reqId === 't1')).error).toMatch(/not available/);
    const engine = new OrderEngine(store, feed, gateway, () => undefined, () => undefined);
    gateway.attach(engine, { getInfo: async (mint: string) => ({ mint, name: 'W', symbol: 'W', twitter: null, website: null }) } as never);
    c.send({ type: 'token.info', reqId: 't2', mint: MINT });
    expect((await c.next((m) => m.reqId === 't2')).data).toMatchObject({ mint: MINT, symbol: 'W' });
  });

  it('returns readable errors for bad commands', async () => {
    const c = await authed(false);
    c.send({ type: 'order.create', reqId: 'x', order: { ...ORDER, amount: { kind: 'usd', value: 1 } } });
    const r = await c.next((m) => m.reqId === 'x');
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Minimum trade/);
  });

  it('sends keepalive pings', async () => {
    const c = await authed(false);
    await c.next((m) => m.type === 'ping');
    c.send({ type: 'pong' });
  });
});

describe('WsGateway execution', () => {
  it('sends triggered orders to the executor and records its result', async () => {
    const ext = await authed(true);
    ext.send({ type: 'order.create', reqId: 'a', order: ORDER });
    await ext.next((m) => m.reqId === 'a');
    feed.tick(MINT, 1);
    const req = await ext.next((m) => m.type === 'exec.request');
    ext.send({ type: 'exec.result', execId: req.execId, result: { ok: true, detail: 'bought' } });
    await ext.next((m) => m.type === 'order' && (m.order as { status: string }).status === 'filled');
    await ext.next((m) => m.type === 'tick');
  });

  it('throttles price broadcasts per mint', async () => {
    const c = await authed(false);
    c.send({ type: 'order.create', reqId: 'a', order: { ...ORDER, trigger: { ...ORDER.trigger, value: 0.001 } } });
    await c.next((m) => m.reqId === 'a');
    feed.tick(MINT, 1);
    feed.tick(MINT, 1.1);
    await c.next((m) => m.type === 'tick');
    await new Promise((r) => setTimeout(r, 20));
    expect(c.msgs.filter((m) => m.type === 'tick')).toHaveLength(1);
  });

  it('marks the order unknown when the extension times out', async () => {
    const ext = await authed(true);
    ext.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const id = ((await ext.next((m) => m.reqId === 'a')).data as { id: string }).id;
    feed.tick(MINT, 1);
    await ext.next((m) => m.type === 'exec.request');
    await vi.waitFor(() => expect(store.get(id)?.status).toBe('unknown'));
    expect(store.get(id)?.lastError).toMatch(/timeout/);
  });

  it('marks the order unknown when the extension disconnects mid-trade', async () => {
    const ext = await authed(true);
    ext.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const id = ((await ext.next((m) => m.reqId === 'a')).data as { id: string }).id;
    feed.tick(MINT, 1);
    await ext.next((m) => m.type === 'exec.request');
    ext.ws.terminate();
    await vi.waitFor(() => expect(store.get(id)?.lastError).toMatch(/disconnected/));
    expect(gateway.isReady()).toBe(false);
  });

  it('holds triggered orders until an executor connects', async () => {
    const ui = await authed(false);
    ui.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const id = ((await ui.next((m) => m.reqId === 'a')).data as { id: string }).id;
    feed.tick(MINT, 1);
    await vi.waitFor(() => expect(store.get(id)?.status).toBe('triggered'));
    expect(await gateway.execute(store.get(id)!)).toMatchObject({ ok: false, kind: 'ui_error' });
    const ext = await authed(true);
    await ext.next((m) => m.type === 'exec.request');
  });
});
