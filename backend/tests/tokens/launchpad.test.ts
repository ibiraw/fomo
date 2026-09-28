/**
 * @file launchpad.test.ts
 * @description v1.8 launchpad lookup: each detector (pump.fun curve, LaunchLab pool on either quote, Meteora DBC via
 *              the pool directory, EVM launchpad contracts), "not this account type" read as absent, and the service's
 *              detector order, caching (short while on the curve, long once settled), shared in-flight lookups and cap.
 * @author Reborn1987
 */

import { getAddressEncoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import type { LaunchpadProtocol } from '../../src/core/evm/launchpad-price-feed.js';
import { deriveBondingCurve } from '../../src/core/pricing/addresses.js';
import type { PoolDirectory } from '../../src/core/pricing/pool-directory.js';
import { deriveLaunchLabPool, LAUNCHLAB_POOL_DISCRIMINATOR } from '../../src/core/pricing/raydium-launchlab.js';
import { LAUNCHLAB_QUOTES } from '../../src/core/pricing/raydium-launchlab-price-feed.js';
import {
  evmLaunchpadDetector, launchLabDetector, LaunchpadService, meteoraDbcDetector, pumpDetector, type Launchpad, type LaunchpadDetector,
} from '../../src/core/tokens/launchpad-service.js';
import { FakeAccounts, curveBytes } from '../helpers/fake-accounts.js';
import { FakeEvmRpc } from '../helpers/fake-evm.js';

const MINT = 'BQYSLwLtTGArYi89xqgsTxFcYLfLJerfwM1TsgZKzray' as Address;
const enc = getAddressEncoder();

/** Minimal LaunchLab pool bytes: discriminator, status, platform, base mint. */
function launchLabBytes(status: number, baseMint: Address = MINT, platform?: Address): Uint8Array {
  const b = new Uint8Array(429);
  b.set(LAUNCHLAB_POOL_DISCRIMINATOR, 0);
  b[17] = status;
  if (platform) b.set(enc.encode(platform), 173);
  b.set(enc.encode(baseMint), 205);
  return b;
}

describe('launchpad detectors', () => {
  it('pump.fun: on the curve, graduated, or not a pump token (missing, empty, or another account type)', async () => {
    const accounts = new FakeAccounts();
    const d = pumpDetector(accounts);
    const curve = await deriveBondingCurve(MINT);
    expect(await d.detect(MINT)).toBeNull();
    accounts.data.set(curve, new Uint8Array(0)); // SOL dusted to the address
    expect(await d.detect(MINT)).toBeNull();
    accounts.data.set(curve, new Uint8Array(200)); // wrong discriminator
    expect(await d.detect(MINT)).toBeNull();
    accounts.data.set(curve, curveBytes({ vToken: 1n, vQuote: 1n }));
    expect(await d.detect(MINT)).toEqual({ id: 'pump', name: 'pump.fun', onCurve: true });
    accounts.data.set(curve, curveBytes({ vToken: 1n, vQuote: 1n, complete: true }));
    expect(await d.detect(MINT)).toEqual({ id: 'pump', name: 'pump.fun', onCurve: false });
  });

  it('Raydium LaunchLab: finds the pool on its second quote too, and reads graduation from its status', async () => {
    const accounts = new FakeAccounts();
    const d = launchLabDetector(accounts);
    expect(await d.detect(MINT)).toBeNull();
    const usd1Pool = await deriveLaunchLabPool(MINT, LAUNCHLAB_QUOTES[1] as Address);
    accounts.data.set(usd1Pool, launchLabBytes(0));
    expect(await d.detect(MINT)).toEqual({ id: 'launchlab', name: 'Raydium LaunchLab', onCurve: true });
    accounts.data.set(usd1Pool, launchLabBytes(2));
    expect(await d.detect(MINT)).toEqual({ id: 'launchlab', name: 'Raydium LaunchLab', onCurve: false });
  });

  it('LaunchLab platforms with other quotes (stonkfun pairs with tokenized stocks): found by searching, named by platform', async () => {
    const accounts = new FakeAccounts();
    const d = launchLabDetector(accounts);
    accounts.data.set('3Vc5zM8nzPuvjxXXrTXbY6K1XCxGRB6WFojxQDLddCjN', launchLabBytes(0, MINT, '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt' as Address));
    expect(await d.detect(MINT)).toEqual({ id: 'launchlab', name: 'stonkfun', onCurve: true });
    expect(await d.detect('So11111111111111111111111111111111111111112')).toBeNull();
  });

  it('Meteora DBC: only a listed pool that decodes and belongs to the token counts', async () => {
    const accounts = new FakeAccounts();
    let listed: { dexId: string; address: string }[] = [];
    const directory = { find: async () => listed } as unknown as PoolDirectory;
    const d = meteoraDbcDetector(accounts, directory);
    expect(await d.detect(MINT)).toBeNull();
    listed = [{ dexId: 'meteoradbc', address: 'Pool1111111111111111111111111111111111111111' }];
    expect(await d.detect(MINT)).toBeNull(); // listed but not on-chain
    accounts.data.set('Pool1111111111111111111111111111111111111111', new Uint8Array(400)); // not a DBC pool
    expect(await d.detect(MINT)).toBeNull();
  });

  it('EVM launchpads: named after the protocol, graduation from the contract', async () => {
    let state: { graduated: boolean } | null = null;
    const protocol = { name: 'four-meme', read: async () => state } as unknown as LaunchpadProtocol;
    const d = evmLaunchpadDetector(new FakeEvmRpc('bnb'), protocol);
    expect(await d.detect('0x' + '1'.repeat(40))).toBeNull();
    state = { graduated: false };
    expect(await d.detect('0x' + '1'.repeat(40))).toEqual({ id: 'four-meme', name: 'four.meme', onCurve: true });
    const flapD = evmLaunchpadDetector(new FakeEvmRpc('base'), { ...protocol, name: 'flap' } as LaunchpadProtocol);
    state = { graduated: true };
    expect(await flapD.detect('0x' + '1'.repeat(40))).toEqual({ id: 'flap', name: 'flap.sh', onCurve: false });
  });
});

describe('LaunchpadService', () => {
  /** A detector that answers from a variable and counts calls. */
  function stub(answer: () => Launchpad | null) {
    const d = { calls: 0, async detect() { d.calls++; return answer(); } };
    return d satisfies LaunchpadDetector;
  }

  it('tries detectors in order per chain, and answers null when none match', async () => {
    const none = stub(() => null);
    const pump = stub(() => ({ id: 'pump', name: 'pump.fun', onCurve: true }));
    const evm = stub(() => null);
    const svc = new LaunchpadService((chain) => (chain === 'solana' ? [none, pump] : [evm]));
    expect(await svc.get(MINT)).toMatchObject({ id: 'pump' });
    expect(none.calls).toBe(1);
    expect(await svc.get('base:0x' + 'a'.repeat(40))).toBeNull();
    expect(evm.calls).toBe(1);
    await expect(svc.get('not-a-token')).rejects.toThrow(/Not a valid token/);
  });

  it('caches on-curve answers for a minute and settled ones for an hour, sharing lookups in flight', async () => {
    let t = 0;
    let answer: Launchpad | null = { id: 'pump', name: 'pump.fun', onCurve: true };
    const d = stub(() => answer);
    const svc = new LaunchpadService(() => [d], () => t);
    await Promise.all([svc.get(MINT), svc.get(MINT)]);
    expect(d.calls).toBe(1);
    t += 59_000;
    await svc.get(MINT);
    expect(d.calls).toBe(1);
    t += 2_000;
    answer = { id: 'pump', name: 'pump.fun', onCurve: false };
    expect(await svc.get(MINT)).toMatchObject({ onCurve: false });
    expect(d.calls).toBe(2);
    t += 30 * 60_000;
    await svc.get(MINT);
    expect(d.calls).toBe(2); // graduated: kept for an hour
  });

  it('keeps at most 2,000 answers, dropping the oldest', async () => {
    const d = stub(() => null);
    const svc = new LaunchpadService(() => [d]);
    const key = (i: number): string => `base:0x${i.toString(16).padStart(40, '0')}`;
    for (let i = 0; i < 2_001; i++) await svc.get(key(i));
    expect(d.calls).toBe(2_001);
    await svc.get(key(2_000)); // newest: cached
    expect(d.calls).toBe(2_001);
    await svc.get(key(0)); // oldest: dropped
    expect(d.calls).toBe(2_002);
  });
});
