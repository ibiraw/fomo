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
import { CompositePriceFeed } from './core/pricing/composite-price-feed.js';
import type { PoolDirectory } from './core/pricing/pool-directory.js';
import type { EvmRpcPort } from './ports/evm-rpc.js';
import type { HttpJsonPort } from './ports/http-json.js';
import type { PriceFeedPort } from './ports/price-feed.js';

/** One EVM chain's pieces. */
export interface EvmChainParts {
  readonly rpc: EvmRpcPort;
  readonly erc20: Erc20Reader;
  readonly quotes: EvmUsdQuotes;
  readonly feed: PriceFeedPort;
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
): EvmChainParts {
  const addr = EVM_ADDRESSES[chain];
  const rpc = new ViemEvmRpcAdapter(chain, urls.http, urls.wss, logError(`rpc:${chain}`));
  const erc20 = new Erc20Reader(rpc);
  const quotes = new EvmUsdQuotes(chain, new Set(addr.stables), addr.wrappedNative);
  const pools = new EvmPoolPriceFeed(chain, rpc, erc20, directory, quotes, addr.v4, logError(`pools:${chain}`));
  const dexscreener = new DexScreenerPriceFeed(chain, http, erc20, 3_000, logError(`dexscreener:${chain}`));
  const afterCurve = new CompositePriceFeed([pools, dexscreener]);
  const curves: PriceFeedPort[] = [];
  if (addr.fourMeme) curves.push(new LaunchpadPriceFeed(rpc, erc20, quotes, fourMeme(addr.fourMeme.manager, addr.fourMeme.helper), afterCurve, logError(`four-meme:${chain}`)));
  if (addr.flapPortal) curves.push(new LaunchpadPriceFeed(rpc, erc20, quotes, flap(addr.flapPortal), afterCurve, logError(`flap:${chain}`)));
  const onchain = new CompositePriceFeed([...curves, pools]);
  quotes.setFeed(onchain);
  return { rpc, erc20, quotes, feed: new CompositePriceFeed([onchain, dexscreener]) };
}
