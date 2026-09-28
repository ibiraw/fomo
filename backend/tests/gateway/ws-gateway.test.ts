/**
 * @file ws-gateway.test.ts
 * @description Tests for WsGateway over real sockets: auth, origin check, commands, execution, broadcasts.
 * @author Reborn1987
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { spotLine, spotText, WsGateway, type GatewayLimits } from '../../src/adapters/gateway/ws-gateway.js';
import { SqliteAccountStoreAdapter } from '../../src/adapters/storage/sqlite-account-store.adapter.js';
import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { AccountService } from '../../src/core/accounts/account-service.js';
import { WalletConfirmers } from '../../src/core/accounts/wallet-confirmers.js';
import { BillingService } from '../../src/core/billing/billing-service.js';
import { STABLE_ASSETS } from '../../src/core/billing/payment-assets.js';
import { SqliteBillingStoreAdapter } from '../../src/adapters/storage/sqlite-billing-store.adapter.js';
import { OrderEngine } from '../../src/core/orders/order-engine.js';
import { DEFAULT_ACCESS, LATEST_VERSION, ReleaseService, type AccessConfig } from '../../src/core/releases/releases.js';
import { LaunchpadService } from '../../src/core/tokens/launchpad-service.js';
import { TokenMetricsService } from '../../src/core/tokens/token-metrics.js';
import { FakePriceFeed } from '../helpers/fakes.js';

const TOKEN = 'k'.repeat(43);
const OTHER = 'o'.repeat(43);
const MINT2 = 'DMPAgkCZmz4TZKJrbV11KGvHZUnCqc8uvnLL62SapDZJ';
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
let accounts: AccountService;
let confirmers: WalletConfirmers;
const sockets: WebSocket[] = [];

/** Opens a socket (optionally with an Origin header) and waits for it to open. */
async function connect(origin?: string): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port()}`, origin ? { origin } : {});
  sockets.push(ws);
  const c = new TestClient(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  return c;
}

/** Connects and logs in (creating the account on first use); `userId` is read from the welcome. */
async function authed(executor: boolean, secret = TOKEN): Promise<TestClient & { userId: string }> {
  const c = await connect('chrome-extension://abc');
  c.send({ type: 'hello', token: secret, executor, create: true });
  const welcome = await c.next((m) => m.type === 'welcome');
  return Object.assign(c, { userId: (welcome.account as { id: string }).id });
}

/** Fresh gateway + engine + accounts. */
async function start(limits?: GatewayLimits, helloTimeoutMs?: number, layoutRetryMs?: number, now: () => number = Date.now, onActivity?: (kind: 'account' | 'payment' | 'order', text: string) => void): Promise<void> {
  feed = new FakePriceFeed();
  store = new SqliteOrderStoreAdapter(':memory:');
  accounts = new AccountService(new SqliteAccountStoreAdapter(':memory:'));
  confirmers = new WalletConfirmers((id) => accounts.wallets(id), () => null);
  gateway = new WsGateway({ host: '127.0.0.1', port: 0, execTimeoutMs: 300, tickThrottleMs: 250, pingIntervalMs: 50, ...(limits ? { limits } : {}), ...(helloTimeoutMs ? { helloTimeoutMs } : {}), ...(layoutRetryMs ? { layoutRetryMs } : {}), ...(onActivity ? { onActivity } : {}) }, () => undefined, now);
  const engine = new OrderEngine(store, feed, gateway, (e) => gateway.handleEngineEvent(e), () => undefined);
  gateway.attach(engine, accounts, confirmers);
  await gateway.listen();
  await engine.start();
}

beforeEach(() => start());

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await gateway.close();
});

describe('WsGateway auth', () => {
  it('rejects browser pages from other origins', async () => {
    await expect(connect('https://evil.example')).rejects.toThrow(/401/);
  });

  it('closes connections with a malformed or unknown key', async () => {
    const c = await connect();
    c.send({ type: 'hello', token: 'wrong', executor: false, create: true });
    await vi.waitFor(() => expect(c.closeCode).toBe(4001));
    const d = await connect();
    d.send({ type: 'hello', token: OTHER, executor: false });
    await vi.waitFor(() => expect(d.closeCode).toBe(4001));
  });

  it('logs back into the same account with the same key', async () => {
    const a = await authed(false);
    const b = await authed(false);
    expect(b.userId).toBe(a.userId);
  });

  it('limits new accounts per network', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    await start({ messagesPerSecond: 20, viewedTokens: 8, accountsPerIpPerHour: 1 });
    await authed(false, TOKEN);
    const c = await connect();
    c.send({ type: 'hello', token: OTHER, executor: false, create: true });
    await vi.waitFor(() => expect(c.closeCode).toBe(4001));
    await authed(false, TOKEN); // existing accounts still log in
  });

  it('closes connections that flood messages', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    await start({ messagesPerSecond: 2, viewedTokens: 8, accountsPerIpPerHour: 5 });
    const c = await authed(false);
    for (let i = 0; i < 10; i++) c.send({ type: 'pong' });
    await vi.waitFor(() => expect(c.closeCode).toBe(4008));
  });

  it('closes unauthenticated clients that skip hello, and reports malformed JSON', async () => {
    const c = await connect();
    c.ws.send('not json');
    await c.next((m) => m.type === 'error');
    c.send({ type: 'order.list', reqId: '1' });
    await vi.waitFor(() => expect(c.closeCode).toBe(4001));
  });

  it('survives an oversized frame: closes that socket (1009) and keeps serving others', async () => {
    const c = await authed(false);
    c.ws.on('error', () => undefined); // the client side sees the abrupt close too
    c.ws.send(JSON.stringify({ type: 'order.list', reqId: 'x'.repeat(70_000) }));
    await vi.waitFor(() => expect(c.closeCode).toBe(1009));
    const d = await authed(false, OTHER);
    d.send({ type: 'order.list', reqId: 'after' });
    await d.next((m) => m.type === 'reply' && m.reqId === 'after');
  });

  it('forgets per-IP counters after their hour, idle tick throttles, and token lists of disconnected accounts', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    let t = Date.now();
    await start(undefined, undefined, undefined, () => t);
    const c = await authed(false); // creates an account from 127.0.0.1
    c.send({ type: 'order.create', reqId: 'a', order: ORDER });
    await c.next((m) => m.reqId === 'a');
    feed.tick(MINT, 5);
    await c.next((m) => m.type === 'tick');
    expect(gateway.stats()).toMatchObject({ created: 1, lastTickSent: 1, orderMints: 1 });
    c.ws.close();
    await vi.waitFor(() => expect(gateway.stats().orderMints).toBe(0));
    t += 3_600_001;
    gateway.prune();
    expect(gateway.stats()).toMatchObject({ created: 0, lastTickSent: 0 });
  });

  it('closes connections that never log in, but not logged-in ones', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    await start(undefined, 150);
    const idle = await connect();
    const user = await authed(false);
    await vi.waitFor(() => expect(idle.closeCode).toBe(4001));
    await new Promise((r) => setTimeout(r, 200));
    expect(user.closeCode).toBeNull();
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

  it('answers wallet.holds (null when no wallet is configured)', async () => {
    const c = await authed(false);
    c.send({ type: 'wallet.holds', reqId: 'h1', mint: MINT });
    expect((await c.next((m) => m.reqId === 'h1')).data).toEqual({ holds: null });
  });

  it('starts a price stream for viewers via price.watch', async () => {
    const c = await authed(false);
    c.send({ type: 'price.watch', reqId: 'w1', mint: MINT });
    expect((await c.next((m) => m.reqId === 'w1')).ok).toBe(true);
    feed.tick(MINT, 3);
    await c.next((m) => m.type === 'tick');
  });

  it('answers token.info, or explains when it is unavailable', async () => {
    const c = await authed(false);
    c.send({ type: 'token.info', reqId: 't1', mint: MINT });
    expect((await c.next((m) => m.reqId === 't1')).error).toMatch(/not available/);
    const engine = new OrderEngine(store, feed, gateway, () => undefined, () => undefined);
    gateway.attach(engine, accounts, confirmers, { getInfo: async (mint: string) => ({ mint, name: 'W', symbol: 'W', twitter: null, website: null }) } as never);
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
    expect(gateway.isReady(ext.userId)).toBe(false);
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

  it("falls back to the account's other device when the active executor disconnects", async () => {
    const pc = await authed(true);
    const mac = await authed(true); // connected last → active executor
    const userId = pc.userId;
    expect(gateway.isReady(userId)).toBe(true);
    mac.ws.close();
    await vi.waitFor(() => expect(mac.closeCode).not.toBeNull());
    await vi.waitFor(() => expect(gateway.isReady(userId)).toBe(true));
    pc.send({ type: 'order.create', reqId: 'a', order: ORDER });
    await pc.next((m) => m.reqId === 'a');
    feed.tick(MINT, 1);
    await pc.next((m) => m.type === 'exec.request'); // the PC gets the trade
    pc.ws.close();
    await vi.waitFor(() => expect(gateway.isReady(userId)).toBe(false));
  });
});

describe('WsGateway accounts', () => {
  it('saves wallets and reports them', async () => {
    const c = await authed(false);
    c.send({ type: 'wallets.set', reqId: 'w', wallets: { solana: 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg', evm: null } });
    expect((await c.next((m) => m.reqId === 'w')).data).toMatchObject({ wallets: { solana: 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg', evm: null } });
    c.send({ type: 'account.info', reqId: 'i' });
    expect((await c.next((m) => m.reqId === 'i')).data).toMatchObject({ id: c.userId });
    c.send({ type: 'wallets.set', reqId: 'bad', wallets: { solana: 'nope', evm: null } });
    expect((await c.next((m) => m.reqId === 'bad')).error).toMatch(/Not a valid Solana address/);
  });

  it('pauses an account after a layout miss (order waits, attempt kept) and resumes on a passing self-check', async () => {
    const ext = await authed(true);
    ext.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const id = ((await ext.next((m) => m.reqId === 'a')).data as { id: string }).id;
    feed.tick(MINT, 1);
    const req = await ext.next((m) => m.type === 'exec.request');
    ext.send({ type: 'exec.result', execId: req.execId, result: { ok: false, kind: 'layout', message: 'Amount box not found' } });
    await vi.waitFor(() => expect(store.get(id)?.status).toBe('triggered'));
    expect(gateway.isReady(ext.userId)).toBe(false);
    expect(store.get(id)?.attempts).toBe(0);
    ext.msgs.length = 0;
    ext.send({ type: 'layout.status', reqId: 'l', ok: true, missing: [] });
    expect((await ext.next((m) => m.reqId === 'l')).data).toEqual({ paused: false });
    const again = await ext.next((m) => m.type === 'exec.request');
    expect((again.order as { id: string }).id).toBe(id);
  });

  it('pauses on a failing self-check, resumes when the layout settings change, and retries on its own', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    await start(undefined, undefined, 150);
    const ext = await authed(true);
    ext.send({ type: 'layout.status', reqId: 'l', ok: false, missing: ['amount input'], snapshot: 'div.panel' });
    expect((await ext.next((m) => m.reqId === 'l')).data).toEqual({ paused: true });
    expect(gateway.isReady(ext.userId)).toBe(false);
    gateway.setFomoDom({ amountInput: 'input.amount' });
    expect(gateway.isReady(ext.userId)).toBe(true);
    ext.send({ type: 'layout.status', reqId: 'm', ok: false, missing: ['amount input'] });
    await ext.next((m) => m.reqId === 'm');
    expect(gateway.isReady(ext.userId)).toBe(false);
    ext.send({ type: 'layout.status', reqId: 'v', newVersion: true }); // a "new version" report doesn't resume
    expect((await ext.next((m) => m.reqId === 'v')).data).toEqual({ paused: true });
    await vi.waitFor(() => expect(gateway.isReady(ext.userId)).toBe(true)); // automatic retry after layoutRetryMs
  });

  it('describes spot buys, full and partial sells with amount and PnL arrow', () => {
    expect(spotLine('buy', 'Buying $25.00 QCAT', null, 'LM-1')).toEqual(['✅', 'LM-1', '**SPOT BUY** on fomo: Buying $25.00 QCAT']);
    expect(spotLine('sell', 'Selling 211.3K QCAT', { all: true, soldPct: 100, usd: 48.2, pnlPct: 12.44 }, 'LM-1')[2])
      .toBe('**SELL ALL** on fomo: Selling 211.3K QCAT for $48.20 ⬆️ 12.4%');
    expect(spotLine('sell', 'Selling 95K QCAT', { all: false, soldPct: 45, usd: 21.67, pnlPct: -8.1 }, 'LM-1')[2])
      .toBe('**PARTIAL SELL** (45%) on fomo: Selling 95K QCAT for $21.67 ⬇️ 8.1%');
    expect(spotLine('sell', 'Selling 95K QCAT', null, 'LM-1')).toEqual(['❌', 'LM-1', '**SPOT SELL** on fomo: Selling 95K QCAT']); // position unreadable
  });

  it("strips the toast's own relative time from spot-trade texts", () => {
    expect(spotText('Buying $25.00 QCATJust now')).toBe('Buying $25.00 QCAT');
    expect(spotText('Selling  1.2M KEK 2m ago')).toBe('Selling 1.2M KEK');
    expect(spotText('Buying $3.00 KEK 15 seconds ago')).toBe('Buying $3.00 KEK');
    expect(spotText('Buying $3.00 AGO')).toBe('Buying $3.00 AGO'); // a token named AGO stays
  });

  it('logs spot trades made on fomo, but not repeats or floods', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    let t = Date.now();
    const activity: string[] = [];
    await start(undefined, undefined, undefined, () => t, (kind, text) => activity.push(`${kind}: ${text}`));
    const c = await authed(false);
    c.send({ type: 'trade.spot', reqId: 's1', side: 'buy', detail: 'Buying  $3.00 KEK', mint: MINT });
    expect((await c.next((m) => m.reqId === 's1')).data).toEqual({ logged: true });
    expect(activity.at(-1)).toMatch(/^order: LM-\w+\n\n🧍LM-\w+\n\n✅ \*\*SPOT BUY\*\* on fomo: Buying \$3\.00 KEK\n\n/); // whitespace squeezed
    expect(activity.at(-1)!.endsWith(`\n\n💜 ${MINT}`)).toBe(true);
    c.send({ type: 'trade.spot', reqId: 's2', side: 'sell', detail: 'Selling 1.2M KEK' });
    expect((await c.next((m) => m.reqId === 's2')).data).toEqual({ logged: false }); // < 3 s after the last
    t += 5_000;
    c.send({ type: 'trade.spot', reqId: 's3', side: 'buy', detail: 'Buying $3.00 KEK', mint: MINT });
    expect((await c.next((m) => m.reqId === 's3')).data).toEqual({ logged: false }); // same text within a minute
    c.send({ type: 'trade.spot', reqId: 's4', side: 'sell', detail: 'Selling 1.2M KEK' });
    expect((await c.next((m) => m.reqId === 's4')).data).toEqual({ logged: true }); // new text, 5 s after the last logged one
    expect(activity.at(-1)).toMatch(/\n\n❌ \*\*SPOT SELL\*\* on fomo: Selling 1\.2M KEK$/); // no token → no address line
    t += 5_000;
    c.send({ type: 'trade.spot', reqId: 's5', side: 'sell', detail: 'Selling 1.2M KEK' });
    expect((await c.next((m) => m.reqId === 's5')).data).toEqual({ logged: false }); // repeat within a minute
    expect(activity.filter((a) => a.includes('SPOT'))).toHaveLength(2);
  });

  it('sends the fomo layout overrides in the welcome and pushes changes to logged-in clients', async () => {
    gateway.setFomoDom({ amountInput: 'input[name=amount]' });
    const c = await authed(false);
    expect(c.msgs.find((m) => m.type === 'welcome')).toMatchObject({ fomoDom: { amountInput: 'input[name=amount]' } });
    const anon = await connect();
    gateway.setFomoDom(null);
    await c.next((m) => m.type === 'fomoDom' && m.overrides === null);
    await new Promise((r) => setTimeout(r, 20));
    expect(anon.msgs.some((m) => m.type === 'fomoDom')).toBe(false); // not logged in → nothing
  });

  it('sends each account its version in the welcome and pushes access changes', async () => {
    let config: AccessConfig = { ...DEFAULT_ACCESS };
    gateway.setReleases(new ReleaseService(() => config));
    const c = await authed(false);
    expect(c.msgs.find((m) => m.type === 'welcome')).toMatchObject({ release: { version: '1.0.0', features: [], early: false } });
    config = { ...config, earlyAccess: [accounts.get(c.userId).shortId] };
    gateway.pushAccess();
    const pushed = await c.next((m) => m.type === 'release');
    expect(pushed.release).toMatchObject({ version: LATEST_VERSION, early: true });
    accounts.delete(c.userId); // deleted while still connected: no crash, it gets the public version
    config = { ...config, publicVersion: '1.1.0' };
    gateway.pushAccess();
    await c.next((m) => m.type === 'release' && (m.release as { version: string }).version === '1.1.0');
  });

  it('answers token.launchpad only for accounts whose version has it', async () => {
    let config: AccessConfig = { ...DEFAULT_ACCESS };
    gateway.setReleases(new ReleaseService(() => config));
    gateway.setLaunchpads(new LaunchpadService(() => [{ detect: async () => ({ id: 'pump', name: 'pump.fun', onCurve: true }) }]));
    const c = await authed(false);
    c.send({ type: 'token.launchpad', reqId: 'l1', mint: MINT });
    expect(await c.next((m) => m.reqId === 'l1')).toMatchObject({ ok: false, error: 'This arrives in limit v1.3.0' });
    config = { ...config, earlyAccess: [accounts.get(c.userId).shortId] };
    c.send({ type: 'token.launchpad', reqId: 'l2', mint: MINT });
    expect(await c.next((m) => m.reqId === 'l2')).toMatchObject({ ok: true, data: { id: 'pump', name: 'pump.fun', onCurve: true } });
  });

  it('answers token.metrics only for accounts whose version has it', async () => {
    let config: AccessConfig = { ...DEFAULT_ACCESS, publicVersion: '1.3.0' };
    gateway.setReleases(new ReleaseService(() => config));
    const metrics = { topTenPct: 12.5, topHoldersPct: [4, 3], devWallet: null, devName: null, devHoldsPct: null, note: 'dev-unknown' };
    gateway.setTokenMetrics(new TokenMetricsService(() => ({ metrics: async () => metrics as never })));
    const c = await authed(false);
    c.send({ type: 'token.metrics', reqId: 'm1', mint: MINT });
    expect(await c.next((m) => m.reqId === 'm1')).toMatchObject({ ok: false, error: 'This arrives in limit v1.4.0' });
    config = { ...config, publicVersion: '1.4.0' };
    c.send({ type: 'token.metrics', reqId: 'm2', mint: MINT });
    expect(await c.next((m) => m.reqId === 'm2')).toMatchObject({ ok: true, data: metrics });
  });

  it("saves the fomo username and fomo's user id and returns them with the account", async () => {
    const c = await authed(false);
    const DID = 'did:privy:cmabc123def456ghi789jkl0m';
    c.send({ type: 'profile.set', reqId: 'p', fomoUsername: 'ibiraw', fomoUserId: DID });
    expect((await c.next((m) => m.reqId === 'p')).data).toMatchObject({ id: c.userId, fomoUsername: 'ibiraw', fomoUserId: DID });
    c.send({ type: 'account.info', reqId: 'i' });
    expect((await c.next((m) => m.reqId === 'i')).data).toMatchObject({ fomoUsername: 'ibiraw', fomoUserId: DID });
    c.send({ type: 'profile.set', reqId: 'bad', fomoUsername: 'no spaces allowed' });
    expect((await c.next((m) => m.reqId === 'bad')).error).toMatch(/Not a fomo username/);
  });

  it("keeps accounts apart: no one sees or cancels another account's orders", async () => {
    const a = await authed(false, TOKEN);
    const b = await authed(false, OTHER);
    a.send({ type: 'order.create', reqId: 'a', order: ORDER });
    const id = ((await a.next((m) => m.reqId === 'a')).data as { id: string }).id;
    b.send({ type: 'order.list', reqId: 'l' });
    expect((await b.next((m) => m.reqId === 'l')).data).toEqual([]);
    b.send({ type: 'order.cancel', reqId: 'c', id });
    expect((await b.next((m) => m.reqId === 'c')).error).toMatch(/not found/);
    feed.tick(MINT, 5);
    await a.next((m) => m.type === 'tick');
    await new Promise((r) => setTimeout(r, 20));
    expect(b.msgs.some((m) => m.type === 'order' || m.type === 'tick')).toBe(false);
  });

  it('keeps only the most recently viewed tokens live per connection', async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await gateway.close();
    await start({ messagesPerSecond: 20, viewedTokens: 1, accountsPerIpPerHour: 5 });
    const c = await authed(false);
    c.send({ type: 'price.watch', reqId: '1', mint: MINT });
    await c.next((m) => m.reqId === '1');
    c.send({ type: 'price.watch', reqId: '2', mint: MINT2 });
    await c.next((m) => m.reqId === '2');
    feed.tick(MINT, 1);
    feed.tick(MINT2, 1);
    await c.next((m) => m.type === 'tick' && (m.tick as { mint: string }).mint === MINT2);
    expect(c.msgs.some((m) => m.type === 'tick' && (m.tick as { mint: string }).mint === MINT)).toBe(false);
  });

  it('deletes the account with its orders and disconnects it', async () => {
    const c = await authed(false);
    c.send({ type: 'order.create', reqId: 'a', order: ORDER });
    await c.next((m) => m.reqId === 'a');
    c.send({ type: 'account.delete', reqId: 'd' });
    expect((await c.next((m) => m.reqId === 'd')).data).toEqual({ deleted: true });
    await vi.waitFor(() => expect(c.closeCode).toBe(4003));
    expect(store.list().map((o) => o.status)).toEqual(['cancelled']); // order history is kept
    const again = await connect();
    again.send({ type: 'hello', token: TOKEN, executor: false });
    await vi.waitFor(() => expect(again.closeCode).toBe(4001));
  });
});

describe('WsGateway paywall', () => {
  it('reports billing in the welcome, quotes, pushes changes and blocks orders after the free ones', async () => {
    sockets.splice(0).forEach((x) => x.terminate());
    await gateway.close();
    feed = new FakePriceFeed();
    store = new SqliteOrderStoreAdapter(':memory:');
    const accountStore = new SqliteAccountStoreAdapter(':memory:');
    accounts = new AccountService(accountStore);
    confirmers = new WalletConfirmers((id) => accounts.wallets(id), () => null);
    gateway = new WsGateway({ host: '127.0.0.1', port: 0, execTimeoutMs: 300, tickThrottleMs: 250, pingIntervalMs: 50 }, () => undefined);
    const billing = new BillingService(
      new SqliteBillingStoreAdapter(':memory:'), accountStore, { priceUsd: 50, tokenPriceUsd: 35, freeOrders: 1, periodDays: 30 },
      { solana: 'JDY8BeQUPmcRZnYJGVBiU7x71SMbdUECW6NMUdGGKQDg', evm: '0x' + 'a'.repeat(40) }, STABLE_ASSETS, null, () => null,
      (id) => ({ filled: store.list(['filled'], id).length, waiting: store.list(['open', 'triggered', 'executing'], id).length }), (id) => gateway.pushBilling(id),
    );
    const engine = new OrderEngine(store, feed, gateway, (e) => gateway.handleEngineEvent(e), () => undefined, () => null, 20_000, Date.now, 25, (id) => billing.assertCanPlaceOrder(id));
    gateway.attach(engine, accounts, confirmers, null, billing);
    await gateway.listen();
    await engine.start();

    const c = await authed(false);
    expect(c.msgs.find((m) => m.type === 'welcome')!.billing).toMatchObject({ unlocked: false, freeOrdersLeft: 1 });
    c.send({ type: 'order.create', reqId: 'a', order: ORDER });
    expect((await c.next((m) => m.reqId === 'a')).ok).toBe(true);
    await c.next((m) => m.type === 'billing' && (m.status as { freeOrdersWaiting: number }).freeOrdersWaiting === 1);
    c.send({ type: 'order.create', reqId: 'b', order: ORDER });
    expect((await c.next((m) => m.reqId === 'b')).error).toMatch(/waiting to fill/);
    c.send({ type: 'billing.quote', reqId: 'q' });
    expect(((await c.next((m) => m.reqId === 'q')).data as { methods: unknown[] }).methods).toHaveLength(6);
    billing.grant(c.userId);
    await c.next((m) => m.type === 'billing' && (m.status as { unlocked: boolean }).unlocked);
    c.send({ type: 'billing.status', reqId: 's' });
    expect((await c.next((m) => m.reqId === 's')).data).toMatchObject({ unlocked: true });
  });

  it('answers billing.quote with an explanation when there is no paywall', async () => {
    const c = await authed(false);
    c.send({ type: 'billing.quote', reqId: 'q' });
    expect((await c.next((m) => m.reqId === 'q')).error).toMatch(/no paywall/);
    c.send({ type: 'billing.status', reqId: 's' });
    expect((await c.next((m) => m.reqId === 's')).data).toBeNull();
  });
});
