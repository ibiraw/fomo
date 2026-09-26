/**
 * @file index.ts
 * @description Composition root: wires adapters into the core and starts the local server.
 * @author Reborn1987
 */

import { WsGateway } from './adapters/gateway/ws-gateway.js';
import { FetchHttpJsonAdapter } from './adapters/http/fetch-http-json.adapter.js';
import { KitSolanaAccountsAdapter } from './adapters/solana/kit-solana-accounts.adapter.js';
import { SqliteOrderStoreAdapter } from './adapters/storage/sqlite-order-store.adapter.js';
import { loadConfig } from './config.js';
import { OrderEngine } from './core/orders/order-engine.js';
import { WalletTradeConfirmer } from './core/orders/wallet-trade-confirmer.js';
import { PumpPriceFeed } from './core/pricing/pump-price-feed.js';
import { TokenInfoService } from './core/tokens/token-info-service.js';

/** Timestamped console logger. */
function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

/** Logs an error with context. */
function logError(ctx: string) {
  return (err: unknown): void => console.error(`${new Date().toISOString()} [${ctx}]`, err);
}

/** Builds and starts every component; shuts down cleanly on Ctrl+C. */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const accounts = new KitSolanaAccountsAdapter(cfg.rpcHttp, cfg.rpcWss, logError('rpc'));
  const feed = new PumpPriceFeed(accounts, logError('price'));
  const store = new SqliteOrderStoreAdapter(cfg.dbPath);
  const gateway = new WsGateway(
    { host: cfg.gatewayHost, port: cfg.gatewayPort, token: cfg.pairingToken, execTimeoutMs: cfg.execTimeoutMs, tickThrottleMs: 250, pingIntervalMs: 20_000 },
    log,
  );
  const confirmer = cfg.fomoWallet ? new WalletTradeConfirmer(accounts, cfg.fomoWallet, 400, logError('confirm')) : null;
  const engine = new OrderEngine(store, feed, gateway, (e) => gateway.handleEngineEvent(e), logError('engine'), confirmer);
  gateway.attach(engine, new TokenInfoService(accounts, new FetchHttpJsonAdapter()));

  await feed.start();
  await gateway.listen();
  await engine.start();
  log(`FOMO limit-order server on ws://${cfg.gatewayHost}:${gateway.port()}`);
  log(`Pairing code for the extension: ${cfg.pairingToken}`);
  log(cfg.fomoWallet ? `On-chain confirmation for wallet ${cfg.fomoWallet}` : 'FOMO_WALLET not set: trades are confirmed from the FOMO page only');

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    engine.stop();
    await gateway.close();
    await feed.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  logError('startup')(err);
  process.exit(1);
});
