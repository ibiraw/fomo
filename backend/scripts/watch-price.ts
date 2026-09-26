/**
 * @file watch-price.ts
 * @description Dev tool: stream live price ticks for a mint. Usage: npm run watch-price -- <mint> [seconds]
 * @author Reborn1987
 */
import { KitSolanaAccountsAdapter } from '../src/adapters/solana/kit-solana-accounts.adapter.js';
import { PumpPriceFeed } from '../src/core/pricing/pump-price-feed.js';

const [mint, secs = '20'] = process.argv.slice(2);
if (!mint) throw new Error('Usage: watch-price <mint> [seconds]');
const http = process.env.SOLANA_RPC_HTTP;
const wss = process.env.SOLANA_RPC_WSS;
if (!http || !wss) throw new Error('SOLANA_RPC_HTTP and SOLANA_RPC_WSS must be set (see .env)');

const accounts = new KitSolanaAccountsAdapter(http, wss, (e) => console.error('stream error', e));
const feed = new PumpPriceFeed(accounts, (e) => console.error('feed error', e));
await feed.start();
let n = 0;
await feed.watch(mint, (t) => {
  n++;
  console.log(new Date(t.receivedAt).toISOString().slice(11, 23), t.source, `$${t.priceUsd.toExponential(6)}`, `MC $${t.marketCapUsd.toFixed(0)}`);
});
setTimeout(() => {
  console.log('ticks:', n);
  void feed.close().then(() => process.exit(0));
}, Number(secs) * 1000);
