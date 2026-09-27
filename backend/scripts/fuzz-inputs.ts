/**
 * @file fuzz-inputs.ts
 * @description Input fuzzer for the WebSocket gateway. Sends every client message type with invalid, hostile and
 *              edge-case values and checks the server never crashes, never hangs, never answers "Internal error",
 *              refuses what it must refuse (including other accounts' orders), resists SQL injection in every text
 *              field (then checks the database is intact) and accepts valid edge values.
 *              Run it against a SEPARATE test server (own port, own DATA_DIR, no Telegram), never the live one.
 *
 *              npx tsx scripts/fuzz-inputs.ts <ws-url> <data-dir>
 * @author Reborn1987
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import WebSocket from 'ws';

import { SqliteAccountStoreAdapter } from '../src/adapters/storage/sqlite-account-store.adapter.js';
import { AccountService } from '../src/core/accounts/account-service.js';

const [url = 'ws://127.0.0.1:8799', dataDir = 'data/loadtest'] = process.argv.slice(2);
const SOL = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const EVM = 'base:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07';
const newKey = (): string => randomBytes(32).toString('base64url');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** SQL injection payloads (classic, blind, stacked, comment, encoding, SQLite-specific). */
const SQLI: string[] = [
  "' OR '1'='1", "' OR 1=1 --", "\" OR \"\"=\"", "'; DROP TABLE orders; --", "'; DROP TABLE accounts; --", "'; DELETE FROM accounts; --",
  "' UNION SELECT * FROM accounts --", "' UNION SELECT secret_hash, id, 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1 FROM accounts --",
  "1; UPDATE paid_access SET paid_until = 9999999999999 --", "admin'--", "') OR ('1'='1", "' AND sleep(5) --",
  "' AND 1=(SELECT COUNT(*) FROM sqlite_master) --", "'; ATTACH DATABASE '/tmp/x.db' AS x; --", "' || (SELECT sqlite_version()) || '",
  "%27%20OR%201%3D1", "\'; --", "' OR ''='", "1' ORDER BY 1--", "*/ OR 1=1 /*", "'; PRAGMA writable_schema=1; --",
  "EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump' OR '1'='1", "base:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07' --",
];

/** Values that are wrong for almost any field. */
const JUNK: unknown[] = [
  null, true, 0, -1, 1e308, -1e308, '', ' ', 'x'.repeat(10_000), '💥🚀', "'; DROP TABLE orders; --", '<script>alert(1)</script>',
  ...SQLI, [], [1, 2], {}, { __proto__: { admin: true } }, { constructor: { prototype: { polluted: 1 } } }, '\u0000', '٣', 'NaN', 'Infinity', '1e999',
];

type Reply = { ok: boolean; error?: string; data?: unknown; timeout?: boolean };

/** Minimal client: request/reply by reqId. */
class Client {
  readonly ws: WebSocket;
  private seq = 0;
  private readonly waiting = new Map<string, (m: Reply) => void>();
  closed: number | null = null;
  errors: string[] = [];
  welcome: Promise<unknown>;

  constructor() {
    this.ws = new WebSocket(url);
    let onWelcome: (v: unknown) => void = () => undefined;
    this.welcome = new Promise((r) => { onWelcome = r; });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { type: string; reqId?: string; message?: string };
      if (m.type === 'welcome') onWelcome(m);
      if (m.type === 'error') this.errors.push(m.message ?? '');
      if (m.type === 'reply' && m.reqId) this.waiting.get(m.reqId)?.(m as never);
    });
    this.ws.on('close', (code) => { this.closed = code; onWelcome(null); });
    this.ws.on('error', () => undefined);
  }

  open(): Promise<boolean> {
    return new Promise((r) => { this.ws.once('open', () => r(true)); this.ws.once('close', () => r(false)); });
  }

  raw(data: string): void { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data); }

  async login(key: string): Promise<boolean> {
    this.raw(JSON.stringify({ type: 'hello', token: key, executor: false }));
    return (await Promise.race([this.welcome, sleep(10_000).then(() => null)])) !== null;
  }

  /** Sends `{type, reqId, ...body}` and waits for the reply (15 s). Paces itself under the rate limit. */
  async request(type: string, body: Record<string, unknown> = {}): Promise<Reply> {
    await sleep(60);
    const reqId = String(++this.seq);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(reqId); resolve({ ok: false, timeout: true }); }, 15_000);
      this.waiting.set(reqId, (m) => { clearTimeout(timer); this.waiting.delete(reqId); resolve(m); });
      this.raw(JSON.stringify({ type, reqId, ...body }));
    });
  }
}

const findings: string[] = [];
let checks = 0;

/** Records a finding when `cond` is false. */
function expectThat(cond: boolean, what: string): void {
  checks++;
  if (!cond) { findings.push(what); console.log(`FINDING  ${what}`); }
}

/** An input that must be refused with a readable error (not accepted, not "Internal error", not a hang). */
function refused(r: Reply, what: string): void {
  expectThat(!r.timeout, `${what}: no reply within 15 s`);
  expectThat(!r.ok, `${what}: ACCEPTED`);
  expectThat(r.error !== 'Internal error', `${what}: Internal error`);
}

/** An input that must be accepted. */
function accepted(r: Reply, what: string): void {
  expectThat(r.ok === true, `${what}: refused (${r.timeout ? 'timeout' : r.error})`);
}

/** Short printable form of a value for reports. */
const show = (v: unknown): string => { const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v); return s.length > 40 ? `${s.slice(0, 37)}…` : s; };

/** A valid order to mutate field by field. */
const base = () => ({ mint: SOL, side: 'buy', trigger: { metric: 'marketCap', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } });

/** Sets a dotted path on a fresh valid order. */
function withField(path: string, value: unknown): Record<string, unknown> {
  const o = base() as Record<string, unknown>;
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
  return o;
}

/** Deletes a dotted path on a fresh valid order. */
function without(path: string): Record<string, unknown> {
  const o = base() as Record<string, unknown>;
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  delete cur[keys.at(-1)!];
  return o;
}

const accounts = new AccountService(new SqliteAccountStoreAdapter(join(dataDir, 'orders.db')));

// ---- before login ----
console.log('== hello ==');
for (const token of JUNK) {
  const c = new Client(); await c.open();
  c.raw(JSON.stringify({ type: 'hello', token, executor: false }));
  await sleep(150);
  expectThat(c.closed !== null || c.errors.length > 0, `hello token=${show(token)}: not refused`);
  c.ws.terminate();
}
for (const [label, body] of [['executor junk', { executor: 'yes' }], ['create junk', { create: 'yes' }], ['no executor', {}]] as const) {
  const c = new Client(); await c.open();
  c.raw(JSON.stringify({ type: 'hello', token: newKey(), ...body }));
  await sleep(150);
  expectThat(c.closed !== null || c.errors.length > 0, `hello ${label}: not refused`);
  c.ws.terminate();
}
for (const raw of ['', 'null', '[]', '"hello"', '{"type":null}', '{"type":"nope"}', '{"__proto__":{"type":"hello"}}', '\u0000\u0001']) {
  const c = new Client(); await c.open();
  c.raw(raw);
  await sleep(150);
  expectThat(c.closed === null && c.errors.length > 0, `raw frame ${show(raw)}: expected "Malformed message" and socket kept`);
  c.ws.terminate();
}

// ---- logged in ----
const keyA = newKey(); accounts.login(keyA, true);
const keyB = newKey(); accounts.login(keyB, true);
const a = new Client(); await a.open(); expectThat(await a.login(keyA), 'login A');
const b = new Client(); await b.open(); expectThat(await b.login(keyB), 'login B');

console.log('== order.create ==');
refused(await a.request('order.create', { order: null }), 'order=null');
for (const v of JUNK) refused(await a.request('order.create', { order: v }), `order=${show(v)}`);
const fields: [string, unknown[]][] = [
  ['mint', [...JUNK, 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpum0', 'polygon:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07', 'base:0x0cbf', 'base:0xZZbf291ba052174879d90bf781df1a5f2bc5bb07', `${SOL} `, `base:${'0'.repeat(40)}`]],
  ['side', [...JUNK, 'BUY', 'Buy', 'short']],
  ['trigger', JUNK],
  ['trigger.metric', [...JUNK, 'mc', 'MarketCap']],
  ['trigger.direction', [...JUNK, 'up', 'BELOW']],
  ['trigger.value', [...JUNK.filter((v) => v !== 1e308), 0, -0.0001, '5']],
  ['trigger.supply', [0, -1, '1000', true, 1e309 /* → null in JSON, allowed */].slice(0, 4)],
  ['amount', JUNK],
  ['amount.kind', [...JUNK, 'USD', 'sol']],
  ['amount.value', [...JUNK.filter((v) => v !== 1e308), 0, 1.99, -5, '5']],
  ['maxAttempts', [0, 11, 1.5, -1, '3', null]],
];
for (const [path, values] of fields) for (const v of values) refused(await a.request('order.create', { order: withField(path, v) }), `order.${path}=${show(v)}`);
for (const p of ['mint', 'side', 'trigger', 'trigger.metric', 'trigger.direction', 'trigger.value', 'amount', 'amount.kind', 'amount.value']) refused(await a.request('order.create', { order: without(p) }), `order without ${p}`);
refused(await a.request('order.create', { order: { ...base(), extra: 1 } }), 'order with extra field');
refused(await a.request('order.create', { order: { ...base(), amount: { kind: 'percent', value: 100.0001 } } }), 'percent 100.0001');
refused(await a.request('order.create', { order: { ...base(), amount: { kind: 'percent', value: 0 } } }), 'percent 0');
// Without a saved wallet the server can't read balances, so sells are allowed (see engine.requireHolding).
accepted(await a.request('order.create', { order: { ...base(), side: 'sell', amount: { kind: 'percent', value: 50 } } }), 'sell with no wallet saved');

console.log('== valid edge values ==');
const ok: Record<string, unknown>[] = [
  withField('amount.value', 2), withField('amount.value', 1_000_000), { ...base(), amount: { kind: 'percent', value: 100 } }, { ...base(), amount: { kind: 'percent', value: 0.01 } },
  withField('trigger.value', 1e-12), withField('trigger.value', 1e15), withField('trigger.supply', 1_000_000_000), withField('mint', EVM),
  withField('mint', 'base:0x0CBF291BA052174879D90BF781DF1A5F2BC5BB07'), withField('trigger.metric', 'price'), withField('trigger.direction', 'above'), { ...base(), maxAttempts: 10 },
];
const created: string[] = [];
for (const o of ok) {
  const r = await a.request('order.create', { order: o });
  accepted(r, `valid order ${show(o).slice(0, 60)}`);
  if (r.ok) created.push((r.data as { id: string }).id);
}
const upper = (await a.request('order.list')).data as { mint: string }[];
expectThat(upper.every((o) => o.mint === o.mint.trim() && (!o.mint.includes(':') || o.mint === o.mint.toLowerCase())), 'EVM token keys stored lower-case');

console.log('== order.cancel / cross-account ==');
for (const id of [...JUNK, 'nope', '00000000-0000-0000-0000-000000000000']) {
  if (typeof id !== 'string') {
    // Non-string ids fail the message schema: "Malformed message", no reply.
    const before = b.errors.length;
    b.raw(JSON.stringify({ type: 'order.cancel', reqId: 'junk', id }));
    await sleep(70);
    expectThat(b.errors.length > before, `cancel id=${show(id)}: not refused`);
  } else refused(await b.request('order.cancel', { id }), `cancel id=${show(id)}`);
}
refused(await b.request('order.cancel', { id: created[0] }), "B cancels A's order");
const listB = (await b.request('order.list')).data as unknown[];
expectThat(Array.isArray(listB) && listB.length === 0, "B's order list shows no orders of A");
accepted(await a.request('order.cancel', { id: created[0] }), 'A cancels own order');
refused(await a.request('order.cancel', { id: created[0] }), 'cancel twice');

console.log('== token.info / price.watch / wallet.holds ==');
const RANDOM_SOL = '11111111111111111111111111111112';
for (const t of ['token.info', 'price.watch', 'wallet.holds']) {
  for (const v of [...JUNK, 'base:0x0cbf', 'polygon:0x0cbf291ba052174879d90bf781df1a5f2bc5bb07']) {
    a.raw(JSON.stringify({ type: t, reqId: 'junk', mint: v }));
    await sleep(70);
    expectThat(a.closed === null, `${t} mint=${show(v)}: socket closed`);
  }
  expectThat(a.errors.length > 0, `${t}: bad mints give "Malformed message"`);
  a.errors = [];
  for (const unknown of [RANDOM_SOL, 'DXkWCeCy4RL4xgbe56PJ47c3xYBQYjH3A5HUMPrBRQ1G' /* a wallet */, 'base:0x000000000000000000000000000000000000dead', 'bnb:0x1111111111111111111111111111111111111111']) {
    const r = await a.request(t, { mint: unknown });
    expectThat(!r.timeout, `${t} ${unknown}: no reply within 15 s`);
    expectThat(r.error !== 'Internal error', `${t} ${unknown}: Internal error`);
  }
}
accepted(await a.request('price.watch', { mint: SOL }), 'price.watch real token');
accepted(await a.request('wallet.holds', { mint: SOL }), 'wallet.holds without wallet (null)');

console.log('== wallets.set ==');
for (const v of [...JUNK, { solana: 'nope' }, { evm: '0x123' }, { evm: '0xZZ09280e5257359947215a6a50361b1625af4dca' }, { solana: SOL.slice(0, 20) }, { solana: 1 }, { extra: 1 }]) {
  refused(await a.request('wallets.set', { wallets: v }), `wallets=${show(v)}`);
}
accepted(await a.request('wallets.set', { wallets: { solana: 'DXkWCeCy4RL4xgbe56PJ47c3xYBQYjH3A5HUMPrBRQ1G', evm: '0xEA09280E5257359947215A6A50361B1625AF4DCA' } }), 'wallets valid (mixed-case EVM)');
const info = (await a.request('account.info')).data as { wallets: { evm: string } };
expectThat(info?.wallets?.evm === '0xea09280e5257359947215a6a50361b1625af4dca', 'EVM wallet stored lower-case');
accepted(await a.request('wallets.set', { wallets: { solana: null, evm: null } }), 'wallets cleared');

console.log('== billing ==');
// (> 300 chars fails the message schema — checked separately below)
for (const tx of [...JUNK.filter((v): v is string => typeof v === 'string' && v.length <= 300), 'https://solscan.io/tx/xyz', 'https://evil.example/tx/0xabc']) {
  const r = await a.request('billing.claim', { tx });
  expectThat(!r.timeout && !r.ok && r.error !== 'Internal error', `billing.claim tx=${show(tx)}`);
}
await a.request('billing.claim', { tx: 'x'.repeat(301) });
expectThat(a.errors.length > 0, 'billing.claim over 300 chars refused as malformed');
a.errors = [];
for (const t of ['billing.status', 'billing.quote', 'account.info', 'order.list']) {
  const r = await a.request(t, { junk: '💥', reqId2: 1 });
  expectThat(!r.timeout && r.error !== 'Internal error', `${t} with extra fields`);
}

console.log('== exec.result ==');
for (const v of [...JUNK.slice(0, 6), { ok: true }, { ok: false, kind: 'nope', message: 'x' }, { ok: true, detail: 'x'.repeat(60_000) }]) {
  a.raw(JSON.stringify({ type: 'exec.result', execId: 'none', result: v }));
  await sleep(80);
}
a.raw(JSON.stringify({ type: 'exec.result', execId: 'x'.repeat(50_000), result: { ok: true, detail: 'fake fill' } }));
await sleep(200);
expectThat(a.closed === null, 'exec.result junk: socket still open');

console.log('== reqId ==');
for (const reqId of [null, 1, {}, 'x'.repeat(50_000)]) {
  a.raw(JSON.stringify({ type: 'order.list', reqId }));
  await sleep(80);
}
expectThat(a.closed === null, 'junk reqIds: socket still open');

console.log('== account.delete ==');
const r = await b.request('account.delete');
accepted(r, 'B deletes own account');
await sleep(300);
expectThat(b.closed === 4003, `B disconnected with 4003 after delete (got ${b.closed})`);
const again = new Client(); await again.open();
expectThat(!(await again.login(keyB)), 'deleted key cannot log in');
expectThat((await a.request('order.list')).ok, 'A unaffected by B deleting');

console.log('== SQL injection in id / reqId / wallets / claim ==');
for (const inj of SQLI) {
  refused(await a.request('order.cancel', { id: inj }), `cancel id=${show(inj)}`);
  refused(await a.request('wallets.set', { wallets: { solana: inj } }), `wallets.solana=${show(inj)}`);
  refused(await a.request('wallets.set', { wallets: { evm: inj } }), `wallets.evm=${show(inj)}`);
  const r = await a.request('billing.claim', { tx: inj });
  expectThat(!r.ok && !r.timeout && r.error !== 'Internal error', `billing.claim tx=${show(inj)}`);
  const l = await a.request('order.list', {});
  expectThat(l.ok, `order.list still works after ${show(inj)}`);
}
for (const inj of SQLI.slice(0, 8)) {
  a.raw(JSON.stringify({ type: 'order.list', reqId: inj }));
  const c = new Client(); await c.open();
  expectThat(!(await c.login(`${inj}${'a'.repeat(40)}`.slice(0, 128))), `hello token with ${show(inj)} does not log in`);
  c.ws.terminate();
}

// Database integrity after everything above.
{
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dataDir, 'orders.db'), { readOnly: true });
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  for (const t of ['orders', 'accounts', 'activity']) expectThat(tables.includes(t), `table ${t} still exists`);
  const aRow = db.prepare('SELECT count(*) n FROM accounts').get() as { n: number };
  expectThat(aRow.n >= 1, `accounts table not emptied (${aRow.n} rows)`);
  const bad = db.prepare("SELECT count(*) n FROM orders WHERE mint LIKE '%''%' OR mint LIKE '%--%' OR mint LIKE '% %'").get() as { n: number };
  expectThat(bad.n === 0, `no injected text stored as a token (${bad.n})`);
  const wallets = db.prepare("SELECT count(*) n FROM accounts WHERE solana_wallet LIKE '%''%' OR evm_wallet LIKE '%''%'").get() as { n: number };
  expectThat(wallets.n === 0, `no injected text stored as a wallet (${wallets.n})`);
  db.close();
}

// Server still alive?
const probe = new Client(); await probe.open();
expectThat(await probe.login(keyA), 'server alive at the end');

console.log(`\n${checks - findings.length}/${checks} checks passed`);
if (findings.length) console.log(`\nFINDINGS:\n- ${findings.join('\n- ')}`);
process.exit(findings.length ? 1 : 0);
