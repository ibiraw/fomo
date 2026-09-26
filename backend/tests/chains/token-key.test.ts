/**
 * @file token-key.test.ts
 * @description Token keys across chains, and the chain routers.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { ChainRouterConfirmer } from '../../src/core/chains/chain-router-confirmer.js';
import { ChainRouterPriceFeed } from '../../src/core/chains/chain-router-price-feed.js';
import { canonicalTokenKey, dexScreenerChain, isTokenKey, parseTokenKey, tokenKey } from '../../src/core/chains/token-key.js';
import { ConfigError, UnsupportedPoolError, ValidationError } from '../../src/core/errors.js';
import { CreateOrderSchema } from '../../src/core/orders/order.js';
import { PriceFeedPort, type PriceListener, type PriceWatch } from '../../src/ports/price-feed.js';
import { TradeConfirmerPort, type BalanceChange } from '../../src/ports/trade-confirmer.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const EVM = '0x9500AF4F2936AAFFBC72860CE19E8D5ED2E8DB07';
const BUY = { side: 'buy', trigger: { metric: 'price', direction: 'below', value: 1 }, amount: { kind: 'usd', value: 5 } };

describe('token keys', () => {
  it('parses Solana mints and chain-prefixed EVM addresses (lowercased)', () => {
    expect(parseTokenKey(MINT)).toEqual({ chain: 'solana', address: MINT });
    expect(parseTokenKey(`base:${EVM}`)).toEqual({ chain: 'base', address: EVM.toLowerCase() });
    expect(tokenKey({ chain: 'bnb', address: EVM as `0x${string}` })).toBe(`bnb:${EVM.toLowerCase()}`);
    expect(tokenKey({ chain: 'solana', address: MINT })).toBe(MINT);
    expect(canonicalTokenKey(`robinhood:${EVM}`)).toBe(`robinhood:${EVM.toLowerCase()}`);
  });

  it('rejects unknown chains and malformed addresses', () => {
    for (const bad of [`monad:${EVM}`, 'base:0x123', EVM, ':0x', 'nope']) {
      expect(isTokenKey(bad)).toBe(false);
      expect(() => parseTokenKey(bad)).toThrow(ValidationError);
    }
  });

  it('maps bnb to DexScreener bsc', () => {
    expect(dexScreenerChain('bnb')).toBe('bsc');
    expect(dexScreenerChain('arc')).toBe('arc');
  });

  it('accepts EVM tokens in orders and normalizes the key', () => {
    expect(CreateOrderSchema.parse({ mint: `bnb:${EVM}`, ...BUY }).mint).toBe(`bnb:${EVM.toLowerCase()}`);
    expect(CreateOrderSchema.safeParse({ mint: `monad:${EVM}`, ...BUY }).success).toBe(false);
  });
});

class NamedFeed extends PriceFeedPort {
  started = 0;
  closed = 0;
  constructor(readonly name: string) { super(); }
  async start(): Promise<void> { this.started++; }
  async close(): Promise<void> { this.closed++; }
  async watch(mint: string, _l: PriceListener): Promise<PriceWatch> { return { mint: `${this.name}|${mint}`, stop: () => undefined }; }
}

class NamedConfirmer extends TradeConfirmerPort {
  constructor(readonly balance: bigint, readonly ok = true) { super(); }
  covers(): boolean { return this.ok; }
  async snapshot(): Promise<bigint> { return this.balance; }
  async waitForChange(_m: string, before: bigint): Promise<BalanceChange | null> { return { before, after: this.balance }; }
}

describe('chain routers', () => {
  it('routes watches by chain and explains disabled chains', async () => {
    const sol = new NamedFeed('sol');
    const base = new NamedFeed('base');
    const router = new ChainRouterPriceFeed(new Map<'solana' | 'base', PriceFeedPort>([['solana', sol], ['base', base]]));
    await router.start();
    expect((await router.watch(MINT, () => undefined)).mint).toBe(`sol|${MINT}`);
    expect((await router.watch(`base:${EVM}`, () => undefined)).mint).toBe(`base|base:${EVM}`);
    await expect(router.watch(`arc:${EVM}`, () => undefined)).rejects.toThrow(UnsupportedPoolError);
    await router.close();
    expect([sol.started, base.started, sol.closed, base.closed]).toEqual([1, 1, 1, 1]);
  });

  it('routes balances by chain; chains without a wallet are not covered', async () => {
    const router = new ChainRouterConfirmer(new Map<'solana' | 'bnb' | 'base', TradeConfirmerPort>([
      ['solana', new NamedConfirmer(5n)],
      ['bnb', new NamedConfirmer(7n)],
      ['base', new NamedConfirmer(1n, false)],
    ]));
    expect(await router.snapshot(MINT)).toBe(5n);
    expect(await router.snapshot(`bnb:${EVM}`)).toBe(7n);
    expect(await router.waitForChange(`bnb:${EVM}`, 1n, 'buy', new AbortController().signal)).toEqual({ before: 1n, after: 7n });
    expect(router.covers(`bnb:${EVM}`)).toBe(true);
    expect(router.covers(`base:${EVM}`)).toBe(false);
    expect(router.covers(`arc:${EVM}`)).toBe(false);
    expect(() => router.snapshot(`arc:${EVM}`)).toThrow(ConfigError);
  });
});
