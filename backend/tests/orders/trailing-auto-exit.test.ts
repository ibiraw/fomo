/**
 * @file trailing-auto-exit.test.ts
 * @description v2.1.0: trailing stops (stop follows new highs, never down, triggers on the drop; raises are quiet
 *              events) and auto take profit / stop loss after a buy (settings, which buys, replacing older exits,
 *              trailing option, waiting for the bought tokens to land, feature gate).
 * @author Reborn1987
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { SqliteAutoExitStoreAdapter } from '../../src/adapters/storage/sqlite-auto-exit-store.adapter.js';
import { SqliteOrderStoreAdapter } from '../../src/adapters/storage/sqlite-order-store.adapter.js';
import { AutoExitService, DEFAULT_AUTO_EXIT, REPLACED_REASON, type AutoExitSettings } from '../../src/core/orders/auto-exit.js';
import { OrderEngine, type EngineEvent } from '../../src/core/orders/order-engine.js';
import type { Order } from '../../src/core/orders/order.js';
import type { TradeConfirmerPort } from '../../src/ports/trade-confirmer.js';
import { FakeExecutor, FakePriceFeed } from '../helpers/fakes.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

let store: SqliteOrderStoreAdapter;
let feed: FakePriceFeed;
let exec: FakeExecutor;
let events: EngineEvent[];
let engine: OrderEngine;

beforeEach(async () => {
  store = new SqliteOrderStoreAdapter(':memory:');
  feed = new FakePriceFeed();
  exec = new FakeExecutor();
  events = [];
  engine = new OrderEngine(store, feed, exec, (e) => events.push(e), () => undefined);
  await engine.start();
});

const trailing = (trailPct: number, reference: number) => ({
  kind: 'trailing', mint: MINT, side: 'sell', metric: 'price', trailPct, reference, amount: { kind: 'percent', value: 100 },
});

describe('trailing stop', () => {
  it('starts from the server price, follows new highs quietly, ignores dips, and sells on the drop', async () => {
    const o = await engine.createOrder('u1', trailing(20, 10));
    expect(o).toMatchObject({ kind: 'trailing', peak: 10, trigger: { direction: 'below', value: 8 } });
    feed.tick(MINT, 15);
    expect(store.get(o.id)).toMatchObject({ status: 'open', peak: 15, trigger: { value: 12 } });
    expect(events.some((e) => e.type === 'order' && e.quiet && e.order.id === o.id)).toBe(true);
    feed.tick(MINT, 13); // a dip above the stop: no change, no trade
    expect(store.get(o.id)).toMatchObject({ status: 'open', peak: 15, trigger: { value: 12 } });
    feed.tick(MINT, 11.9);
    await settle();
    expect(store.get(o.id)?.status).toBe('filled');
  });

  it('uses the latest server value as the starting high when there is one', async () => {
    await engine.viewMint(MINT);
    feed.tick(MINT, 50);
    const o = await engine.createOrder('u1', trailing(10, 40));
    expect(o).toMatchObject({ peak: 50, trigger: { value: 45 } });
  });

  it('refuses buys and out-of-range distances', async () => {
    await expect(engine.createOrder('u1', { ...trailing(20, 10), side: 'buy' })).rejects.toThrow();
    await expect(engine.createOrder('u1', trailing(0.5, 10))).rejects.toThrow(/at least 1%/);
    await expect(engine.createOrder('u1', trailing(95, 10))).rejects.toThrow(/at most 90%/);
  });
});

describe('auto take profit / stop loss', () => {
  let auto: AutoExitService;
  let allowed: boolean;
  let reports: string[];
  let balance: bigint;
  const wallet = { covers: () => true, snapshot: async () => balance } as unknown as TradeConfirmerPort;
  let withWallet: boolean;

  const on = (patch: Partial<AutoExitSettings> = {}): void => { auto.set('u1', { ...DEFAULT_AUTO_EXIT, enabled: true, ...patch }); };
  const autoOrders = (statuses: Order['status'][] = ['open']): Order[] => engine.listOrders('u1', statuses).filter((o) => o.source === 'auto');

  beforeEach(() => {
    allowed = true;
    reports = [];
    balance = 0n;
    withWallet = false;
    auto = new AutoExitService(
      new SqliteAutoExitStoreAdapter(':memory:'), engine, () => (withWallet ? wallet : null), () => allowed,
      (_u, _m, line) => reports.push(line), () => undefined, { pollMs: 5, landMs: 200, priceMs: 100 },
    );
    engine.onBuyFilled((o, p) => auto.onOrderFilled(o, p));
  });

  const buyFillsAt = async (price: number): Promise<void> => {
    await engine.createOrder('u1', { mint: MINT, side: 'buy', trigger: { metric: 'price', direction: 'below', value: price }, amount: { kind: 'usd', value: 5 } });
    feed.tick(MINT, price);
    await settle(20);
  };

  it('is off by default (take profit +100% / stop loss −50%, both selling everything, once switched on)', async () => {
    expect(auto.get('u1')).toEqual(DEFAULT_AUTO_EXIT);
    expect(DEFAULT_AUTO_EXIT).toMatchObject({ enabled: false, takeProfit: { pct: 100, sellPct: 100 }, stopLoss: { pct: 50, sellPct: 100, trailing: false } });
    await buyFillsAt(1);
    expect(autoOrders()).toHaveLength(0);
  });

  it('places a take profit and a stop loss from the fill price after a limit buy', async () => {
    on();
    await buyFillsAt(2);
    const [a, b] = autoOrders();
    const tp = [a, b].find((o) => o?.trigger.direction === 'above')!;
    const sl = [a, b].find((o) => o?.trigger.direction === 'below')!;
    expect(tp).toMatchObject({ side: 'sell', trigger: { metric: 'price', value: 4 }, amount: { kind: 'percent', value: 100 } });
    expect(sl).toMatchObject({ side: 'sell', kind: 'limit', trigger: { value: 1 } });
  });

  it('uses a trailing stop when chosen, and replaces older exits on a new buy', async () => {
    on({ stopLoss: { ...DEFAULT_AUTO_EXIT.stopLoss, trailing: true, pct: 25 } });
    await buyFillsAt(2);
    const first = autoOrders().map((o) => o.id);
    expect(autoOrders().find((o) => o.kind === 'trailing')).toMatchObject({ trailPct: 25, peak: 2, trigger: { value: 1.5 } });
    await buyFillsAt(1.9);
    expect(autoOrders()).toHaveLength(2);
    for (const id of first) expect(store.get(id)).toMatchObject({ status: 'cancelled', lastError: REPLACED_REASON });
  });

  it('respects which buys the user picked and the feature gate', async () => {
    on({ buys: { limit: false, quick: true, manual: false } });
    await buyFillsAt(1);
    expect(autoOrders()).toHaveLength(0);
    allowed = false;
    on();
    await buyFillsAt(1);
    expect(autoOrders()).toHaveLength(0);
  });

  it('waits for a quick buy to land in the wallet before placing exits', async () => {
    on();
    withWallet = true;
    await engine.viewMint(MINT);
    feed.tick(MINT, 3);
    auto.onBuy('u1', MINT, 'quick');
    await settle(30);
    expect(autoOrders()).toHaveLength(0); // tokens not there yet
    balance = 1000n;
    await settle(30);
    expect(autoOrders().map((o) => o.trigger.value).sort()).toEqual([1.5, 6]);
  });

  it('gives up (and says so) when the bought tokens never show up', async () => {
    on({ buys: { limit: true, quick: true, manual: true } });
    withWallet = true;
    auto.onBuy('u1', MINT, 'manual');
    await settle(300);
    expect(autoOrders()).toHaveLength(0);
    expect(reports[0]).toMatch(/never showed up/);
  });

  it('rejects bad settings', () => {
    expect(() => auto.set('u1', { ...DEFAULT_AUTO_EXIT, stopLoss: { ...DEFAULT_AUTO_EXIT.stopLoss, pct: 95 } })).toThrow();
    expect(() => auto.set('u1', { enabled: true })).toThrow();
  });
});
