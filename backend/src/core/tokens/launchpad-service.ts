/**
 * @file launchpad-service.ts
 * @description v1.8 — which launchpad a token was launched on, and whether it is still on the launchpad's bonding
 *              curve or has graduated to a DEX. Each launchpad has a detector that reads the token's launchpad account
 *              on-chain (the account stays after graduation, so graduated tokens are recognised too):
 *                Solana: pump.fun (bonding-curve PDA), Raydium LaunchLab (pool PDA for a SOL or USD1 quote, else a
 *                        search of LaunchLab's pools by token — e.g. stonkfun pairs with tokenized stocks; named after
 *                        the platform when known),
 *                        Meteora DBC (pool listed on DexScreener, verified on-chain)
 *                EVM:    four.meme (BNB), flap.sh (BNB, Base, Robinhood)
 *              No detector matching means the token was not launched on a launchpad limit knows (e.g. straight to a
 *              DEX). Answers are cached: a graduated or launchpad-less answer for an hour, an on-curve one for a minute.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';

import { AccountDecodeError } from '../errors.js';
import { parseTokenKey, type Chain } from '../chains/token-key.js';
import { isRevert } from '../evm/contract.js';
import type { CurveState, LaunchpadProtocol } from '../evm/launchpad-price-feed.js';
import { deriveBondingCurve } from '../pricing/addresses.js';
import { decodeBondingCurve } from '../pricing/decoders.js';
import { decodeDbcPool } from '../pricing/meteora-dbc.js';
import type { PoolDirectory } from '../pricing/pool-directory.js';
import { decodeLaunchLabPool, deriveLaunchLabPool, LAUNCHLAB_TRADING, RAYDIUM_LAUNCHLAB_PROGRAM, type LaunchLabPool } from '../pricing/raydium-launchlab.js';
import { LAUNCHLAB_QUOTES } from '../pricing/raydium-launchlab-price-feed.js';
import type { EvmRpcPort, Hex } from '../../ports/evm-rpc.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';

export type LaunchpadId = 'pump' | 'launchlab' | 'meteora-dbc' | 'four-meme' | 'flap';

/** Where a token was launched. */
export interface Launchpad {
  readonly id: LaunchpadId;
  /** Display name ("pump.fun"). */
  readonly name: string;
  /** Still trading on the launchpad's bonding curve (false: graduated to a DEX). */
  readonly onCurve: boolean;
}

/** Recognises one launchpad. */
export interface LaunchpadDetector {
  /** The token's launchpad, or null when it wasn't launched here. `address` is the chain-native address. */
  detect(address: string): Promise<Launchpad | null>;
}

/** Decodes an account, treating "not this account type" as absent (anything else is a real error). */
function decodeOrNull<T>(raw: Uint8Array | null, decode: (d: Uint8Array) => T): T | null {
  if (!raw || raw.length === 0) return null; // missing, or only SOL someone sent to the address
  try {
    return decode(raw);
  } catch (err) {
    if (err instanceof AccountDecodeError) return null;
    throw err;
  }
}

/** pump.fun: the token's bonding-curve account. */
export function pumpDetector(accounts: SolanaAccountsPort): LaunchpadDetector {
  return {
    async detect(mint) {
      const curve = decodeOrNull(await accounts.getAccount(await deriveBondingCurve(mint as Address)), decodeBondingCurve);
      return curve ? { id: 'pump', name: 'pump.fun', onCurve: !curve.complete } : null;
    },
  };
}

/** The dev of a pump.fun token: the creator its bonding curve records (pump.fun pays creator rewards there). */
export function pumpCreator(accounts: SolanaAccountsPort): (mint: string) => Promise<string | null> {
  return async (mint) => decodeOrNull(await accounts.getAccount(await deriveBondingCurve(mint as Address)), decodeBondingCurve)?.creator ?? null;
}

/**
 * Platforms built on LaunchLab, by their platform config (read from a pool of a token the owner knew the platform of).
 * Unknown platforms show as "Raydium LaunchLab".
 */
export const LAUNCHLAB_PLATFORMS: Readonly<Record<string, string>> = {
  '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt': 'stonkfun', // FLIGHT14, 2026-09-28
};

/** LaunchLab pool account size (the search filter). */
const LAUNCHLAB_POOL_SIZE = 429;
/** Where a LaunchLab pool stores its token (base mint). */
const LAUNCHLAB_BASE_MINT_OFFSET = 205;

/**
 * Raydium LaunchLab and the platforms built on it: the token's pool — found by address for a SOL or USD1 quote, else
 * by searching LaunchLab's pools for the token (any quote).
 */
export function launchLabDetector(accounts: SolanaAccountsPort): LaunchpadDetector {
  const found = (pool: LaunchLabPool): Launchpad => ({
    id: 'launchlab',
    name: LAUNCHLAB_PLATFORMS[pool.platformConfig] ?? 'Raydium LaunchLab',
    onCurve: pool.status === LAUNCHLAB_TRADING,
  });
  return {
    async detect(mint) {
      for (const quote of LAUNCHLAB_QUOTES) {
        const pool = decodeOrNull(await accounts.getAccount(await deriveLaunchLabPool(mint as Address, quote as Address)), decodeLaunchLabPool);
        if (pool && pool.baseMint === mint) return found(pool);
      }
      const [addr] = await accounts.findProgramAccounts(RAYDIUM_LAUNCHLAB_PROGRAM, LAUNCHLAB_POOL_SIZE, { offset: LAUNCHLAB_BASE_MINT_OFFSET, bytes: mint });
      const pool = addr ? decodeOrNull(await accounts.getAccount(addr), decodeLaunchLabPool) : null;
      return pool && pool.baseMint === mint ? found(pool) : null;
    },
  };
}

/** Meteora Dynamic Bonding Curve: the token's pool as listed on DexScreener, verified on-chain. */
export function meteoraDbcDetector(accounts: SolanaAccountsPort, directory: PoolDirectory): LaunchpadDetector {
  return {
    async detect(mint) {
      const listed = (await directory.find(mint)).find((p) => p.dexId === 'meteoradbc');
      if (!listed) return null;
      const pool = decodeOrNull(await accounts.getAccount(listed.address), decodeDbcPool);
      return pool && pool.baseMint === mint ? { id: 'meteora-dbc', name: 'Meteora DBC', onCurve: !pool.isMigrated } : null;
    },
  };
}

/** An EVM launchpad (four.meme, flap.sh): its contract knows every token it launched. */
export function evmLaunchpadDetector(rpc: EvmRpcPort, protocol: LaunchpadProtocol): LaunchpadDetector {
  const name = protocol.name === 'four-meme' ? 'four.meme' : 'flap.sh';
  return {
    async detect(address) {
      let state: CurveState | null;
      try {
        state = await protocol.read(rpc, address as Hex);
      } catch (err) {
        if (!isRevert(err)) throw err;
        state = null; // the launchpad rejects tokens it didn't launch
      }
      return state ? { id: protocol.name, name, onCurve: !state.graduated } : null;
    },
  };
}

const ON_CURVE_TTL_MS = 60_000;
const SETTLED_TTL_MS = 60 * 60_000;
/** Cached answers kept at most (oldest dropped first). */
const MAX_CACHED = 2_000;

export class LaunchpadService {
  private readonly cache = new Map<string, { at: number; value: Launchpad | null }>();
  private readonly inflight = new Map<string, Promise<Launchpad | null>>();

  /** @param detectors the launchpads of a chain, in the order to try @param now clock */
  constructor(private readonly detectors: (chain: Chain) => readonly LaunchpadDetector[], private readonly now: () => number = Date.now) {}

  /** The token's launchpad (null: none limit knows). `key` is a token key (Solana mint or `<chain>:<0x…>`). */
  async get(key: string): Promise<Launchpad | null> {
    const ref = parseTokenKey(key);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (hit.value?.onCurve ? ON_CURVE_TTL_MS : SETTLED_TTL_MS)) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.detect(ref.chain, ref.address).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    const value = await p;
    this.cache.delete(key); // re-insert so the newest answers are the last to be dropped
    this.cache.set(key, { at: this.now(), value });
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  /** Runs the chain's detectors in order; the first match wins. */
  private async detect(chain: Chain, address: string): Promise<Launchpad | null> {
    for (const d of this.detectors(chain)) {
      const found = await d.detect(address);
      if (found) return found;
    }
    return null;
  }
}
