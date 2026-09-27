/**
 * @file erc20-confirmer.test.ts
 * @description ERC-20 reads, pool math and the EVM wallet confirmer.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { AccountNotFoundError, ConfigError } from '../../src/core/errors.js';
import { ERC20_ABI, Erc20Reader, NATIVE } from '../../src/core/evm/erc20.js';
import { EvmWalletConfirmer } from '../../src/core/evm/evm-wallet-confirmer.js';
import { priceFromReserves, priceFromSqrtX96, toUnits } from '../../src/core/evm/pool-math.js';
import { FakeEvmRpc } from '../helpers/fake-evm.js';

const TOKEN = '0x9500af4f2936aaffbc72860ce19e8d5ed2e8db07';
const WALLET = '0x59a1b6cc4cfc711ce0fa70f48fef4e4b7dd2b103';

describe('Erc20Reader', () => {
  it('reads metadata, supply and balances; caches decimals; native is 18', async () => {
    const rpc = new FakeEvmRpc()
      .on(TOKEN, ERC20_ABI, 'decimals', 9)
      .on(TOKEN, ERC20_ABI, 'symbol', 'DEMO')
      .on(TOKEN, ERC20_ABI, 'name', 'Demo')
      .on(TOKEN, ERC20_ABI, 'totalSupply', 10n ** 18n)
      .on(TOKEN, ERC20_ABI, 'balanceOf', 42n);
    const r = new Erc20Reader(rpc);
    expect(await r.decimals(TOKEN)).toBe(9);
    expect(await r.decimals(TOKEN)).toBe(9);
    expect(rpc.calls).toBe(1);
    expect(await r.decimals(NATIVE)).toBe(18);
    expect([await r.symbol(TOKEN), await r.name(TOKEN), await r.totalSupply(TOKEN), await r.balanceOf(TOKEN, WALLET)]).toEqual(['DEMO', 'Demo', 10n ** 18n, 42n]);
  });

  it('does not cache a failed decimals read', async () => {
    const rpc = new FakeEvmRpc().on(TOKEN, ERC20_ABI, 'decimals', new Error('rpc down'));
    const r = new Erc20Reader(rpc);
    await expect(r.decimals(TOKEN)).rejects.toThrow('rpc down');
    rpc.on(TOKEN, ERC20_ABI, 'decimals', 6);
    expect(await r.decimals(TOKEN)).toBe(6);
  });

  it('reports an address without a contract as "not a token" (empty call data), not a decode crash', async () => {
    const rpc = new FakeEvmRpc().raw(TOKEN, '0x313ce567', '0x'); // decimals() selector
    const r = new Erc20Reader(rpc);
    const err = await r.decimals(TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountNotFoundError);
    expect((err as Error).message).toMatch(/No contract at .* \(not a token\)/);
  });
});

describe('pool math', () => {
  it('prices constant-product reserves with decimals', () => {
    expect(priceFromReserves(1_000n * 10n ** 18n, 2n * 10n ** 18n, 18, 18)).toBeCloseTo(0.002);
    expect(priceFromReserves(10n ** 9n, 5n * 10n ** 6n, 9, 6)).toBeCloseTo(5);
    expect(priceFromReserves(0n, 1n, 18, 18)).toBe(0);
  });

  it('prices sqrtPriceX96 from either side', () => {
    const sqrt = 2n ** 96n * 2n; // raw token1/token0 = 4
    expect(priceFromSqrtX96(sqrt, 18, 18, true)).toBeCloseTo(4);
    expect(priceFromSqrtX96(sqrt, 18, 18, false)).toBeCloseTo(0.25);
    expect(priceFromSqrtX96(sqrt, 18, 6, true)).toBeCloseTo(4e12);
    expect(priceFromSqrtX96(0n, 18, 18, true)).toBe(0);
    expect(toUnits(1_500_000n, 6)).toBe(1.5);
  });
});

describe('EvmWalletConfirmer', () => {
  const setup = () => {
    let balance = 0n;
    const rpc = new FakeEvmRpc('bnb').on(TOKEN, ERC20_ABI, 'balanceOf', () => ('0x' + balance.toString(16).padStart(64, '0')) as `0x${string}`);
    const errors: unknown[] = [];
    const c = new EvmWalletConfirmer(new Map([['bnb', new Erc20Reader(rpc)]]), WALLET, 5, (e) => errors.push(e));
    return { c, errors, set: (b: bigint) => { balance = b; } };
  };

  it('covers enabled EVM chains only', () => {
    const { c } = setup();
    expect(c.covers(`bnb:${TOKEN}`)).toBe(true);
    expect(c.covers(`base:${TOKEN}`)).toBe(false);
    expect(c.covers('EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump')).toBe(false);
    expect(c.covers('garbage')).toBe(false);
  });

  it('reads balances and waits for them to move', async () => {
    const { c, set } = setup();
    set(3n);
    expect(await c.snapshot(`bnb:${TOKEN}`)).toBe(3n);
    const waiting = c.waitForChange(`bnb:${TOKEN}`, 3n, 'buy', new AbortController().signal);
    setTimeout(() => set(10n), 15);
    expect(await waiting).toEqual({ before: 3n, after: 10n });
    await expect(c.snapshot(`base:${TOKEN}`)).rejects.toThrow(ConfigError);
  });

  it('keeps polling through errors and stops on abort', async () => {
    const { c, errors } = setup();
    const abort = new AbortController();
    const waiting = c.waitForChange(`base:${TOKEN}`, 0n, 'sell', abort.signal);
    setTimeout(() => abort.abort(), 20);
    expect(await waiting).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});
