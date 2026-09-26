/**
 * @file watch-evm-price.ts
 * @description Dev tool: stream live price ticks for an EVM token through the same feeds the server uses.
 *              Usage: npm run watch-evm-price -- <chain>:<0xaddress> [seconds]   (chain: ethereum|base|bnb|robinhood|arc)
 * @author Reborn1987
 */
import { FetchHttpJsonAdapter } from '../src/adapters/http/fetch-http-json.adapter.js';
import { loadConfig } from '../src/config.js';
import { parseTokenKey } from '../src/core/chains/token-key.js';
import { PoolDirectory } from '../src/core/pricing/pool-directory.js';
import { buildEvmChain } from '../src/evm-chain.js';

const [key, secs = '20'] = process.argv.slice(2);
if (!key) throw new Error('Usage: watch-evm-price <chain>:<0xaddress> [seconds]');
const { chain } = parseTokenKey(key);
if (chain === 'solana') throw new Error('Use watch-price for Solana mints');
const urls = loadConfig().evm.get(chain);
if (!urls) throw new Error(`${chain} RPC URLs are not set in .env`);

const http = new FetchHttpJsonAdapter();
const parts = buildEvmChain(chain, urls, new PoolDirectory(http), http, (ctx) => (e) => console.error(ctx, e instanceof Error ? e.message.split('\n')[0] : e));
let n = 0;
await parts.feed.watch(key, (t) => {
  n++;
  console.log(new Date(t.receivedAt).toISOString().slice(11, 23), t.source, `$${t.priceUsd.toExponential(6)}`, `MC $${t.marketCapUsd.toFixed(0)}`);
});
setTimeout(() => {
  console.log('ticks:', n);
  void parts.rpc.close().then(() => process.exit(0));
}, Number(secs) * 1000);
