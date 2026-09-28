/**
 * @file check-launchpad.ts
 * @description Dev tool: which launchpad each token came from (v1.8), through the same detectors the server uses.
 *              Usage: npx tsx --env-file=.env scripts/check-launchpad.ts <token key> [<token key> …]
 * @author Reborn1987
 */
import { FetchHttpJsonAdapter } from '../src/adapters/http/fetch-http-json.adapter.js';
import { KitSolanaAccountsAdapter } from '../src/adapters/solana/kit-solana-accounts.adapter.js';
import { loadConfig } from '../src/config.js';
import type { EvmChain } from '../src/core/chains/token-key.js';
import { PoolDirectory } from '../src/core/pricing/pool-directory.js';
import { launchLabDetector, LaunchpadService, meteoraDbcDetector, pumpDetector } from '../src/core/tokens/launchpad-service.js';
import { buildEvmChain, type EvmChainParts } from '../src/evm-chain.js';

const keys = process.argv.slice(2);
if (keys.length === 0) throw new Error('Usage: check-launchpad <token key> [<token key> …]');
const cfg = loadConfig();
const http = new FetchHttpJsonAdapter();
const directory = new PoolDirectory(http);
const log = (ctx: string) => (e: unknown): void => console.error(ctx, e instanceof Error ? e.message.split('\n')[0] : e);
const accounts = new KitSolanaAccountsAdapter(cfg.rpcHttp, cfg.rpcWss, log('rpc'));
const evm = new Map<EvmChain, EvmChainParts>([...cfg.evm].map(([chain, urls]) => [chain, buildEvmChain(chain, urls, directory, http, log)]));
const solana = [pumpDetector(accounts), launchLabDetector(accounts), meteoraDbcDetector(accounts, directory)];
const svc = new LaunchpadService((chain) => (chain === 'solana' ? solana : evm.get(chain)?.launchpads ?? []));

for (const key of keys) {
  try {
    const lp = await svc.get(key);
    console.log(key.padEnd(52), lp ? `${lp.name}${lp.onCurve ? ' (on the curve)' : ' (graduated)'}` : 'no launchpad found');
  } catch (err) {
    console.log(key.padEnd(52), 'ERROR', err instanceof Error ? err.message : err);
  }
}
await Promise.all([...evm.values()].map((p) => p.rpc.close()));
process.exit(0);
