/**
 * @file check-metrics.ts
 * @description Dev tool: v1.9 token metrics (top-10 holders' share, dev holdings) through the same code the server uses.
 *              Usage: npx tsx --env-file=.env scripts/check-metrics.ts <token key> [<token key> …]
 * @author Reborn1987
 */
import { FetchHttpJsonAdapter } from '../src/adapters/http/fetch-http-json.adapter.js';
import { KitSolanaAccountsAdapter } from '../src/adapters/solana/kit-solana-accounts.adapter.js';
import { loadConfig } from '../src/config.js';
import type { EvmChain } from '../src/core/chains/token-key.js';
import { PoolDirectory } from '../src/core/pricing/pool-directory.js';
import { pumpCreator } from '../src/core/tokens/launchpad-service.js';
import { DEFAULT_EVM_INDEX, EVM_SCAN_CHUNKS, EvmHolderIndex, SolanaTokenMetrics, TokenMetricsService, type TokenMetricsSource } from '../src/core/tokens/token-metrics.js';
import { buildEvmChain, type EvmChainParts } from '../src/evm-chain.js';

const keys = process.argv.slice(2);
if (keys.length === 0) throw new Error('Usage: check-metrics <token key> [<token key> …]');
const cfg = loadConfig();
const http = new FetchHttpJsonAdapter();
const log = (ctx: string) => (e: unknown): void => console.error(ctx, e instanceof Error ? e.message.split('\n')[0] : e);
const accounts = new KitSolanaAccountsAdapter(cfg.rpcHttp, cfg.rpcWss, log('rpc'));
const evm = new Map<EvmChain, EvmChainParts>([...cfg.evm].map(([chain, urls]) => [chain, buildEvmChain(chain, urls, new PoolDirectory(http), http, log)]));
const sources = new Map<string, TokenMetricsSource>([
  ['solana', new SolanaTokenMetrics(accounts, pumpCreator(accounts))],
  ...[...evm].map(([chain, p]) => [chain, new EvmHolderIndex(p.rpc, p.erc20, { ...DEFAULT_EVM_INDEX, maxChunks: EVM_SCAN_CHUNKS[chain] })] as const),
]);
const svc = new TokenMetricsService((chain) => sources.get(chain) ?? null);

for (const key of keys) {
  const t0 = Date.now();
  try {
    const m = await svc.get(key);
    const top = m.topTenPct === null ? '—' : `${m.topTenPct.toFixed(2)}%`;
    const dev = m.devWallet ? `${m.devWallet.slice(0, 8)}… holds ${m.devHoldsPct?.toFixed(2)}%` : 'dev unknown';
    console.log(key.padEnd(52), `top10 ${top}`.padEnd(14), dev.padEnd(34), m.note ?? '', `(${Date.now() - t0} ms)`);
  } catch (err) {
    console.log(key.padEnd(52), 'ERROR', err instanceof Error ? err.message.split('\n')[0] : err);
  }
}
await Promise.all([...evm.values()].map((p) => p.rpc.close()));
process.exit(0);
