/**
 * @file load-test.ts
 * @description Limit + load test for the WebSocket gateway. Run it against a SEPARATE test server (own port, own
 *              DATA_DIR, no Telegram), never the live one: it creates accounts and orders.
 *
 *              npx tsx scripts/load-test.ts <ws-url> <data-dir> [users=200] [ordersPerUser=5]   (SKIP_LIMITS=1: load only)
 *
 *              Limits: rate limit (4008), message before hello, malformed JSON, oversized frame, browser origin,
 *              account creation per IP, open-order cap, bad order input, idle unauthenticated socket.
 *              Load: pre-seeds N accounts in the test DB, connects them all at once, each places orders that can
 *              never trigger (buy at MC below $1) on a few real tokens; reports latency percentiles and failures.
 * @author Reborn1987
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import WebSocket from 'ws';

import { SqliteAccountStoreAdapter } from '../src/adapters/storage/sqlite-account-store.adapter.js';
import { AccountService } from '../src/core/accounts/account-service.js';

const [url = 'ws://127.0.0.1:8799', dataDir = 'data/loadtest', usersArg = '200', ordersArg = '5'] = process.argv.slice(2);
const USERS = Number(usersArg);
const ORDERS_PER_USER = Number(ordersArg);
/** Real tokens (Solana + Base) so orders go through the live price feeds. */
const TOKENS = [
  'ARPwPPWbaj3FYBf6k1Lt2jqRkv9JJUg3Hxav5aHKTEem',
  'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump',
  'base:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07',
];

/** A fresh random account key (same format the extension makes). */
const newKey = (): string => randomBytes(32).toString('base64url');

/** Buy that can never trigger: market cap below $1. */
const neverOrder = (mint: string, over: Record<string, unknown> = {}) => ({
  mint, side: 'buy', trigger: { metric: 'marketCap', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 }, ...over,
});

/** Minimal client: request/reply by reqId, records close code. */
class Client {
  readonly ws: WebSocket;
  private seq = 0;
  private readonly waiting = new Map<string, (m: { ok: boolean; error?: string; data?: unknown }) => void>();
  closed: { code: number; reason: string } | null = null;
  welcome: Promise<unknown>;
  errors: string[] = [];

  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    let onWelcome: (v: unknown) => void = () => undefined;
    this.welcome = new Promise((r) => { onWelcome = r; });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { type: string; reqId?: string; message?: string };
      if (m.type === 'welcome') onWelcome(m);
      if (m.type === 'error') this.errors.push(m.message ?? '');
      if (m.type === 'reply' && m.reqId) this.waiting.get(m.reqId)?.(m as never);
    });
    this.ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      onWelcome(null);
      for (const w of this.waiting.values()) w({ ok: false, error: `closed ${code}` });
    });
    this.ws.on('error', () => undefined);
  }

  open(): Promise<boolean> {
    return new Promise((r) => {
      this.ws.once('open', () => r(true));
      this.ws.once('close', () => r(false));
      this.ws.once('unexpected-response', () => r(false));
    });
  }

  send(obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  async hello(token: string, create = false): Promise<unknown> {
    this.send({ type: 'hello', token, executor: false, create });
    return Promise.race([this.welcome, sleep(10_000).then(() => null)]);
  }

  request(type: string, body: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<{ ok: boolean; error?: string; data?: unknown; ms: number }> {
    const reqId = String(++this.seq);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(reqId); resolve({ ok: false, error: 'timeout', ms: performance.now() - t0 }); }, timeoutMs);
      this.waiting.set(reqId, (m) => { clearTimeout(timer); this.waiting.delete(reqId); resolve({ ...m, ms: performance.now() - t0 }); });
      this.send({ type, reqId, ...body });
    });
  }

  waitClose(ms = 3_000): Promise<{ code: number; reason: string } | null> {
    return Promise.race([
      new Promise<{ code: number; reason: string }>((r) => (this.closed ? r(this.closed) : this.ws.once('close', (code, reason) => r({ code, reason: reason.toString() })))),
      sleep(ms).then(() => null),
    ]);
  }

  close(): void { this.ws.close(); }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

/** p-th percentile of sorted numbers. */
const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! : NaN);
const fmt = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `p50 ${pct(s, 50).toFixed(0)}ms · p95 ${pct(s, 95).toFixed(0)}ms · p99 ${pct(s, 99).toFixed(0)}ms · max ${s.at(-1)?.toFixed(0)}ms`; };

/** Limit tests. Returns the keys of accounts it created. */
async function limits(accounts: AccountService): Promise<void> {
  console.log('\n== Limits ==');

  // Message before hello.
  let c = new Client(); await c.open();
  c.send({ type: 'order.list', reqId: '1' });
  let cl = await c.waitClose();
  check('message before login is refused', cl?.code === 4001, `close ${cl?.code} ${cl?.reason}`);

  // Browser origin.
  c = new Client({ Origin: 'https://evil.example' });
  check('browser (website) origin is refused', !(await c.open()), 'upgrade rejected');

  // Invalid key.
  c = new Client(); await c.open();
  c.send({ type: 'hello', token: 'short', executor: false });
  cl = await c.waitClose();
  check('invalid key is refused', cl?.code === 4001, `close ${cl?.code} ${cl?.reason}`);

  // Unknown key without create.
  c = new Client(); await c.open();
  c.send({ type: 'hello', token: newKey(), executor: false });
  cl = await c.waitClose();
  check('unknown key without create is refused', cl?.code === 4001, `close ${cl?.code} ${cl?.reason}`);

  // Account creation per IP (5 / hour): 6th fails.
  const created: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    c = new Client(); await c.open();
    created.push((await c.hello(newKey(), true)) !== null);
    c.close();
  }
  check('account creation capped at 5 per IP per hour', created.slice(0, 5).every(Boolean) && !created[5], `created: ${created.map((x) => (x ? 'y' : 'n')).join('')}`);

  // Logged-in limits use a seeded account.
  const key = newKey(); accounts.login(key, true);
  c = new Client(); await c.open(); await c.hello(key);

  // Malformed JSON keeps the socket open.
  c.send('{not json');
  await sleep(300);
  check('malformed JSON gets an error, socket stays open', c.errors.includes('Malformed message') && !c.closed, `errors: ${c.errors.join(', ')}`);

  // Bad order inputs.
  const bad = await Promise.all([
    c.request('order.create', { order: neverOrder('not-a-token') }),
    c.request('order.create', { order: neverOrder(TOKENS[0]!, { amount: { kind: 'usd', value: 0.01 } }) }),
    c.request('order.create', { order: neverOrder(TOKENS[0]!, { amount: { kind: 'percent', value: 150 } }) }),
    c.request('order.create', { order: neverOrder(TOKENS[0]!, { trigger: { metric: 'marketCap', direction: 'below', value: -5 } }) }),
    c.request('order.create', { order: { ...neverOrder(TOKENS[0]!), extra: 'field' } }),
    c.request('order.create', { order: neverOrder(TOKENS[0]!, { maxAttempts: 1000 }) }),
  ]);
  check('invalid orders rejected (bad token, tiny $, >100%, negative trigger, extra field, attempts)', bad.every((r) => !r.ok), bad.map((r) => (r.ok ? 'ACCEPTED' : 'no')).join(' '));

  // Open-order cap (25): the 26th is refused.
  const placed: boolean[] = [];
  for (let i = 0; i < 26; i++) {
    placed.push((await c.request('order.create', { order: neverOrder(TOKENS[i % TOKENS.length]!) })).ok);
    await sleep(60); // stay under the message rate limit
  }
  const last = placed.at(-1);
  check('open orders capped at 25 per account', placed.slice(0, 25).every(Boolean) && last === false, `${placed.filter(Boolean).length} accepted`);

  // Viewed tokens: 9 watches all succeed (oldest is dropped, not refused).
  // Rate limit: 60 messages at once → closed 4008.
  for (let i = 0; i < 60; i++) c.send({ type: 'order.list', reqId: `burst${i}` });
  cl = await c.waitClose();
  check('message flood closes the socket (rate limit)', cl?.code === 4008, `close ${cl?.code} ${cl?.reason}`);

  // Oversized frame (> 64 KB).
  const key2 = newKey(); accounts.login(key2, true);
  c = new Client(); await c.open(); await c.hello(key2);
  c.send(JSON.stringify({ type: 'order.list', reqId: 'x'.repeat(70_000) }));
  cl = await c.waitClose();
  check('oversized message (>64 KB) closes the socket', cl?.code === 1009, `close ${cl?.code}`);

  // Idle socket that never logs in.
  c = new Client(); await c.open();
  cl = await c.waitClose(15_000);
  check('idle socket that never logs in is dropped (within 15 s)', cl !== null, cl ? `closed ${cl.code}` : 'still open after 15 s');
  c.close();
}

/** Load test: USERS accounts connect at once and place ORDERS_PER_USER orders each. */
async function load(accounts: AccountService): Promise<void> {
  console.log(`\n== Load: ${USERS} users × ${ORDERS_PER_USER} orders ==`);
  const keys = Array.from({ length: USERS }, () => { const k = newKey(); accounts.login(k, true); return k; });

  const mem0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const connectMs: number[] = [];
  const clients = await Promise.all(keys.map(async (k) => {
    const s = performance.now();
    const c = new Client();
    if (!(await c.open())) return null;
    const w = await c.hello(k);
    if (w === null) return null;
    connectMs.push(performance.now() - s);
    return c;
  }));
  const ok = clients.filter((c): c is Client => c !== null);
  check(`${USERS} users connect and log in`, ok.length === USERS, `${ok.length}/${USERS} in ${((performance.now() - t0) / 1000).toFixed(1)}s · ${fmt(connectMs)}`);

  const orderMs: number[] = [];
  let failed = 0;
  const failReasons = new Map<string, number>();
  const t1 = performance.now();
  await Promise.all(ok.map(async (c, i) => {
    for (let j = 0; j < ORDERS_PER_USER; j++) {
      const r = await c.request('order.create', { order: neverOrder(TOKENS[(i + j) % TOKENS.length]!) });
      if (r.ok) orderMs.push(r.ms);
      else { failed++; failReasons.set(r.error ?? '?', (failReasons.get(r.error ?? '?') ?? 0) + 1); }
    }
  }));
  const total = ok.length * ORDERS_PER_USER;
  const secs = (performance.now() - t1) / 1000;
  check(`${total} orders placed concurrently`, failed === 0, `${total - failed}/${total} in ${secs.toFixed(1)}s (${((total - failed) / secs).toFixed(0)}/s) · ${fmt(orderMs)}${failed ? ` · failures: ${[...failReasons].map(([e, n]) => `${n}× ${e}`).join('; ')}` : ''}`);

  // Everyone lists + watches at once.
  const listMs: number[] = [];
  await Promise.all(ok.map(async (c, i) => {
    const r = await c.request('order.list'); if (r.ok) listMs.push(r.ms);
    await c.request('price.watch', { mint: TOKENS[i % TOKENS.length] });
  }));
  check('order.list for everyone at once', listMs.length === ok.length, fmt(listMs));

  // Ticks keep flowing to all clients for 10 s.
  let ticks = 0;
  for (const c of ok) c.ws.on('message', (raw) => { if (raw.toString().startsWith('{"type":"tick"')) ticks++; });
  await sleep(10_000);
  check('live price ticks delivered to watchers (10 s)', ticks > 0, `${ticks} ticks to ${ok.length} clients (${(ticks / ok.length).toFixed(1)} each)`);

  // Cancel everything.
  const cancelMs: number[] = [];
  await Promise.all(ok.map(async (c) => {
    const list = await c.request('order.list');
    for (const o of (list.data as { id: string; status: string }[] | undefined) ?? []) {
      if (o.status !== 'open') continue;
      const r = await c.request('order.cancel', { id: o.id }); if (r.ok) cancelMs.push(r.ms);
    }
  }));
  check(`cancel all orders`, cancelMs.length === total - failed, `${cancelMs.length} cancelled · ${fmt(cancelMs)}`);
  console.log(`(load client RSS grew ${((process.memoryUsage().rss - mem0) / 1e6).toFixed(0)} MB)`);
  for (const c of ok) c.close();
}

const store = new SqliteAccountStoreAdapter(join(dataDir, 'orders.db'));
const accounts = new AccountService(store);
// SKIP_LIMITS=1 re-runs only the load phase (the per-IP account limit stays spent for an hour after a limits run).
if (!process.env.SKIP_LIMITS) await limits(accounts);
await load(accounts);
const failedChecks = results.filter((r) => !r.pass);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
