/**
 * @file evm-chain.ts
 * @description Composition for one EVM chain (used by index.ts and dev scripts): RPC, ERC-20 reads, USD quotes,
 *              launchpad curves → v2/v3/v4 pools → DexScreener fallback.
 * @author Reborn1987
 */

import { ViemEvmRpcAdapter } from './adapters/evm/viem-evm-rpc.adapter.js';
import type { EvmChain } from './core/chains/token-key.js';
import { DexScreenerPriceFeed } from './core/evm/dexscreener-price-feed.js';
import { Erc20Reader } from './core/evm/erc20.js';
import { EVM_ADDRESSES } from './core/evm/evm-addresses.js';
import { EvmPoolPriceFeed } from './core/evm/evm-pool-price-feed.js';
import { EvmUsdQuotes } from './core/evm/evm-usd-quotes.js';
import { flap, fourMeme, LaunchpadPriceFeed } from './core/evm/launchpad-price-feed.js';
import { evmLaunchpadDetector, type LaunchpadDetector } from './core/tokens/launchpad-service.js';
import { CompositePriceFeed } from './core/pricing/composite-price-feed.js';
import type { PoolDirectory } from './core/pricing/pool-directory.js';
import type { EvmRpcPort } from './ports/evm-rpc.js';
import type { HttpJsonPort } from './ports/http-json.js';
import type { PriceFeedPort } from './ports/price-feed.js';
import type { ConnectionHealth } from './ports/connection-health.js';

/** One EVM chain's pieces. */
export interface EvmChainParts {
  readonly rpc: EvmRpcPort;
  readonly erc20: Erc20Reader;
  readonly quotes: EvmUsdQuotes;
  readonly feed: PriceFeedPort;
  /** The chain's launchpads (four.meme, flap.sh) for "where was this token launched". */
  readonly launchpads: readonly LaunchpadDetector[];
}

/** Error log + health sink for one RPC connection (health drives the "stayed down" alerts). */
export interface RpcSinks {
  readonly onError: (err: unknown) => void;
  readonly health: ConnectionHealth | null;
}

/**
 * Wires one EVM chain: launchpad curves (four.meme, flap.sh) first, then v2/v3/v4 pools, DexScreener last.
 * Graduated launchpad tokens are handed to pools (or DexScreener until their pool is listed).
 */
export function buildEvmChain(
  chain: EvmChain,
  urls: { readonly http: string; readonly wss: string },
  directory: PoolDirectory,
  http: HttpJsonPort,
  logError: (ctx: string) => (err: unknown) => void,
  connection?: (ctx: string) => RpcSinks,
): EvmChainParts {
  const addr = EVM_ADDRESSES[chain];
  const sinks = connection?.(`rpc:${chain}`) ?? { onError: logError(`rpc:${chain}`), health: null };
  const rpc = new ViemEvmRpcAdapter(chain, urls.http, urls.wss, sinks.onError, sinks.health);
  const erc20 = new Erc20Reader(rpc);
  const quotes = new EvmUsdQuotes(chain, new Set(addr.stables), addr.wrappedNative);
  const pools = new EvmPoolPriceFeed(chain, rpc, erc20, directory, quotes, addr.v4, logError(`pools:${chain}`));
  const dexscreener = new DexScreenerPriceFeed(chain, http, erc20, 3_000, logError(`dexscreener:${chain}`));
  const afterCurve = new CompositePriceFeed([pools, dexscreener]);
  const protocols = [
    ...(addr.fourMeme ? [{ protocol: fourMeme(addr.fourMeme.manager, addr.fourMeme.helper), ctx: 'four-meme' }] : []),
    ...(addr.flapPortal ? [{ protocol: flap(addr.flapPortal), ctx: 'flap' }] : []),
  ];
  const curves: PriceFeedPort[] = protocols.map(({ protocol, ctx }) => new LaunchpadPriceFeed(rpc, erc20, quotes, protocol, afterCurve, logError(`${ctx}:${chain}`)));
  const onchain = new CompositePriceFeed([...curves, pools]);
  quotes.setFeed(onchain);
  const launchpads = protocols.map(({ protocol }) => evmLaunchpadDetector(rpc, protocol));
  return { rpc, erc20, quotes, feed: new CompositePriceFeed([onchain, dexscreener]), launchpads };
}
