/**
 * @file index.ts
 * @description Composition root: wires adapters into the core and starts the local server.
 * @author Reborn1987
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { WsGateway } from './adapters/gateway/ws-gateway.js';
import { FetchHttpJsonAdapter } from './adapters/http/fetch-http-json.adapter.js';
import { KitSolanaAccountsAdapter } from './adapters/solana/kit-solana-accounts.adapter.js';
import { SqliteAccountStoreAdapter } from './adapters/storage/sqlite-account-store.adapter.js';
import { SqliteOrderStoreAdapter } from './adapters/storage/sqlite-order-store.adapter.js';
import { buildBilling } from './billing-setup.js';
import { loadConfig } from './config.js';
import { SqliteActivityStoreAdapter } from './adapters/storage/sqlite-activity-store.adapter.js';
import { FileAccessConfigAdapter } from './adapters/config/file-access-config.adapter.js';
import { FileFomoDomAdapter } from './adapters/config/file-fomo-dom.adapter.js';
import { ReleaseService } from './core/releases/releases.js';
import { launchLabDetector, LaunchpadService, meteoraDbcDetector, pumpDetector, solanaDev } from './core/tokens/launchpad-service.js';
import { DEFAULT_EVM_INDEX, EVM_SCAN_CHUNKS, EvmHolderIndex, SolanaTokenMetrics, TokenMetricsService, type TokenMetricsSource } from './core/tokens/token-metrics.js';
import { TelegramNotifierAdapter } from './adapters/telegram/telegram-notifier.adapter.js';
import { ActivityRelay } from './core/monitoring/activity-relay.js';
import { ErrorLog, errorHeadline } from './core/monitoring/error-log.js';
import { LayoutAlerts } from './core/monitoring/layout-alerts.js';
import { OutageTracker } from './core/monitoring/outage-tracker.js';
import { describeOrder } from './core/monitoring/describe.js';
import { TokenLabeler } from './core/monitoring/token-line.js';
import { AccountService } from './core/accounts/account-service.js';
import { WalletConfirmers } from './core/accounts/wallet-confirmers.js';
import { ChainRouterConfirmer } from './core/chains/chain-router-confirmer.js';
import { ChainRouterPriceFeed } from './core/chains/chain-router-price-feed.js';
import type { Chain, EvmChain } from './core/chains/token-key.js';
import { buildEvmChain, type EvmChainParts } from './evm-chain.js';
import { EvmWalletConfirmer } from './core/evm/evm-wallet-confirmer.js';
import { metricValue } from './core/orders/order.js';
import { OrderEngine } from './core/orders/order-engine.js';
import { HoldingsGuard } from './core/orders/holdings-guard.js';
import { WalletTradeConfirmer } from './core/orders/wallet-trade-confirmer.js';
import { CompositePriceFeed } from './core/pricing/composite-price-feed.js';
import { JupiterPriceFeed } from './core/pricing/jupiter-price-feed.js';
import { MeteoraDammV2PriceFeed } from './core/pricing/meteora-damm-v2-price-feed.js';
import { MeteoraDbcPriceFeed } from './core/pricing/meteora-dbc-price-feed.js';
import { PoolDirectory } from './core/pricing/pool-directory.js';
import { PumpPriceFeed } from './core/pricing/pump-price-feed.js';
import { RaydiumCpmmPriceFeed } from './core/pricing/raydium-cpmm-price-feed.js';
import { RaydiumLaunchLabPriceFeed } from './core/pricing/raydium-launchlab-price-feed.js';
import { UsdQuotes } from './core/pricing/usd-quotes.js';
import { TokenInfoService } from './core/tokens/token-info-service.js';
import type { PriceFeedPort } from './ports/price-feed.js';
import type { TradeConfirmerPort } from './ports/trade-confirmer.js';

/** Account that owns everything created before accounts existed (its key is the old pairing code). */
const LEGACY_ACCOUNT_ID = 'legacy';

/** Timestamped console logger. */
function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

/** Monitoring relay (activity log + Telegram); set once the config is loaded. */
let monitor: ActivityRelay | null = null;

/** Console error sink with repeat suppression (one full dump per incident). */
const errorLog = new ErrorLog(console.error);

/** Logs an error with context, and reports it to monitoring (rate-limited per source). */
function logError(ctx: string) {
  return (err: unknown): void => {
    errorLog.log(ctx, err);
    if (ctx !== 'telegram') monitor?.recordError(ctx, err);
  };
}

/** Logs an error to the console only (RPC socket drops: their alerts come from the outage tracker). */
function logOnly(ctx: string) {
  return (err: unknown): void => errorLog.log(ctx, err);
}

/** Builds and starts every component; shuts down cleanly on Ctrl+C. */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const activityStore = new SqliteActivityStoreAdapter(cfg.dbPath);
  // The users' group gets user activity; the owner's private chat gets server notices and alerts (see ROUTE).
  monitor = new ActivityRelay(
    activityStore,
    cfg.telegram ? new TelegramNotifierAdapter(cfg.telegram.token, cfg.telegram.chatId) : null,
    logError('telegram'),
    1_000,
    Date.now,
    cfg.telegram?.ownerChatId ? new TelegramNotifierAdapter(cfg.telegram.token, cfg.telegram.ownerChatId) : null,
  );
  const relay = monitor;
  // RPC sockets drop and self-heal about hourly; only outages that last 2+ minutes reach Telegram.
  const outages = new OutageTracker((kind, text) => relay.record(kind, text));
  const rpcSinks = (ctx: string) => ({ onError: logOnly(ctx), health: outages.for(ctx) });
  // Empty-update glitches are expected and self-healing: one log line each, no stack trace.
  const rpcWarn = (err: unknown): void => log(`[rpc] ${errorHeadline(err)}`);
  const accounts = new KitSolanaAccountsAdapter(cfg.rpcHttp, cfg.rpcWss, logOnly('rpc'), outages.for('rpc'), rpcWarn);
  const http = new FetchHttpJsonAdapter();
  const jupiterHttp = new FetchHttpJsonAdapter(cfg.jupiter.apiKey ? { 'x-api-key': cfg.jupiter.apiKey } : {});
  const quotes = new UsdQuotes(accounts, jupiterHttp, cfg.jupiter.url, 5_000, logError('quotes'));
  const directory = new PoolDirectory(http);
  const cpmm = new RaydiumCpmmPriceFeed(accounts, directory, quotes, logError('raydium-cpmm'));
  const jupiter = new JupiterPriceFeed(jupiterHttp, accounts, { url: cfg.jupiter.url, pollMs: cfg.jupiter.pollMs }, logError('jupiter'));
  const damm2 = new MeteoraDammV2PriceFeed(accounts, directory, quotes, logError('meteora-damm2'));
  // Fast on-chain feeds first; Jupiter covers every other token (slower, polled).
  const onchain = new CompositePriceFeed([
    new PumpPriceFeed(accounts, logError('price')),
    new RaydiumLaunchLabPriceFeed(accounts, quotes, cpmm, logError('raydium-launchlab')),
    cpmm,
    // DBC curves migrate to DAMM v2; fall back to Jupiter if that pool isn't listed yet.
    new MeteoraDbcPriceFeed(accounts, directory, quotes, new CompositePriceFeed([damm2, jupiter]), logError('meteora-dbc')),
    damm2,
  ]);
  // Quote tokens like VBUCKS are priced through the same on-chain feeds before falling back to Jupiter.
  quotes.setOnchainFeed(onchain);
  const solanaFeed = new CompositePriceFeed([onchain, jupiter]);
  const evm = new Map<EvmChain, EvmChainParts>([...cfg.evm].map(([chain, urls]) => [chain, buildEvmChain(chain, urls, directory, http, logError, rpcSinks)]));
  const feed = new ChainRouterPriceFeed(new Map<Chain, PriceFeedPort>([['solana', solanaFeed], ...[...evm].map(([c, p]) => [c, p.feed] as const)]));
  const erc20ByChain = new Map([...evm].map(([c, p]) => [c, p.erc20] as const));
  const store = new SqliteOrderStoreAdapter(cfg.dbPath, Date.now, LEGACY_ACCOUNT_ID);
  const accountStore = new SqliteAccountStoreAdapter(cfg.dbPath);
  const accountService = new AccountService(accountStore);
  /** Short id of an account for monitoring messages, with the fomo username once known ("LM-7K3Q2P (@name)"). */
  const who = (userId: string): string => {
    const a = accountStore.get(userId);
    if (!a) return userId.slice(0, 8);
    return a.fomoUsername ? `${a.shortId} (@${a.fomoUsername})` : a.shortId;
  };
  // The pre-accounts owner keeps working: their pairing code is the key of the "legacy" account, whose wallets come from .env.
  accountService.ensureLegacy(LEGACY_ACCOUNT_ID, cfg.pairingToken, { solana: cfg.fomoWallet, evm: cfg.fomoEvmWallet });
  // fomo self-check reports → one alert per redesign; snapshots saved next to the database for fixing fomo-dom.json.
  const layoutDir = join(dirname(cfg.dbPath), 'layout-reports');
  const layoutAlerts = new LayoutAlerts((kind, text) => relay.record(kind, text), (label, snapshot) => {
    mkdirSync(layoutDir, { recursive: true });
    const file = join(layoutDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.txt`);
    writeFileSync(file, snapshot);
    // Keep the newest 50 (names start with the timestamp, so they sort by age).
    for (const old of readdirSync(layoutDir).sort().slice(0, -50)) rmSync(join(layoutDir, old), { force: true });
    return file;
  });
  // Monitoring entries get the token's ticker and name ("💜 $COMPUTE Compute" + the full address), in order.
  const tokenInfo = new TokenInfoService(accounts, http, Date.now, erc20ByChain);
  const tickers = new TokenLabeler(
    (key) => tokenInfo.getInfo(key).then((i) => ({ symbol: i.symbol, name: i.name })),
    (kind: Parameters<typeof relay.record>[0], text) => relay.record(kind, text),
  );
  const gateway = new WsGateway(
    {
      host: cfg.gatewayHost, port: cfg.gatewayPort, execTimeoutMs: cfg.execTimeoutMs, tickThrottleMs: 250, pingIntervalMs: 20_000,
      trustProxy: cfg.trustProxy,
      onActivity: (kind, text) => tickers.push(kind, text),
      onLayout: (report) => layoutAlerts.handle(report),
    },
    log,
  );
  // On-chain confirmation per account: its Solana wallet for Solana tokens, its EVM wallet (same address on every EVM chain) for EVM tokens.
  const walletConfirmers = new WalletConfirmers((id) => accountService.wallets(id), (w) => {
    const byChain = new Map<Chain, TradeConfirmerPort>();
    if (w.solana) byChain.set('solana', new WalletTradeConfirmer(accounts, w.solana, 400, logError('confirm')));
    if (w.evm) {
      const evmConfirmer = new EvmWalletConfirmer(erc20ByChain, w.evm, 400, logError('confirm:evm'));
      for (const c of evm.keys()) byChain.set(c, evmConfirmer);
    }
    return byChain.size > 0 ? new ChainRouterConfirmer(byChain) : null;
  });
  const confirmerFor = (userId: string) => walletConfirmers.for(userId);
  // The free trial: fills use up free orders; waiting orders hold one each.
  const orderCounts = (userId: string) => ({
    filled: store.list(['filled'], userId).length,
    waiting: store.list(['open', 'triggered', 'executing'], userId).length,
  });
  // Staged releases and friends: DATA_DIR/access.json holds the public version, the early-access list and free-until
  // dates (by limit ID). Edits go live within seconds. The owner always has early access.
  const access = new FileAccessConfigAdapter(join(dirname(cfg.dbPath), 'access.json'), logError('access'));
  const releases = new ReleaseService(() => access.current(), new Set([LEGACY_ACCOUNT_ID]));
  const freeUntil = (userId: string): number | null => {
    const a = accountStore.get(userId);
    return a ? releases.freeUntil(a.shortId) : null;
  };
  const billing = cfg.paywall
    ? await buildBilling({
      cfg, paywall: cfg.paywall, accounts: accountStore, solana: accounts,
      evm: new Map([...evm].map(([c, p]) => [c, { rpc: p.rpc, erc20: p.erc20 }] as const)),
      feed, orderCounts, onChange: (userId) => gateway.pushBilling(userId), log, logError,
      activity: (kind, text) => relay.record(kind, text), who, freeUntil,
    })
    : null;
  // The owner never pays.
  if (billing && billing.service.status(LEGACY_ACCOUNT_ID).unlocked === false) billing.service.grant(LEGACY_ACCOUNT_ID);
  let guard: HoldingsGuard | null = null;
  const engine = new OrderEngine(store, feed, gateway, (e) => {
    gateway.handleEngineEvent(e);
    if (e.type === 'order') {
      guard?.onOrderChanged(e.order);
      log(`order ${e.order.id.slice(0, 8)} ${e.order.userId.slice(0, 8)} ${e.order.side} ${e.order.status}${e.order.lastError ? ` — ${e.order.lastError}` : ''}`);
      const tick = engine.latestTick(e.order.mint);
      const text = describeOrder(e.order, who(e.order.userId), tick ? metricValue(e.order, tick) : null);
      if (text) tickers.push('order', text);
    }
  }, logError('engine'), confirmerFor, 20_000, Date.now, cfg.maxActiveOrdersPerUser, (userId) => billing?.service.assertCanPlaceOrder(userId));
  // Open sells are cancelled once their account no longer holds the token.
  guard = new HoldingsGuard(engine, confirmerFor, 20_000, logError('holdings'));
  gateway.attach(engine, accountService, walletConfirmers, tokenInfo, billing?.service ?? null);
  gateway.setReleases(releases);
  // v1.8: where a token was launched (pump.fun, LaunchLab, Meteora DBC; four.meme and flap.sh on EVM chains).
  const solanaLaunchpads = [pumpDetector(accounts), launchLabDetector(accounts), meteoraDbcDetector(accounts, directory)];
  gateway.setLaunchpads(new LaunchpadService((chain) => (chain === 'solana' ? solanaLaunchpads : evm.get(chain)?.launchpads ?? [])));
  // v1.9: top-10 holders' share and dev holdings (Solana: largest accounts; EVM: fresh tokens' transfers replayed).
  const metricsSources = new Map<string, TokenMetricsSource>([
    ['solana', new SolanaTokenMetrics(accounts, solanaDev(accounts, directory))],
    ...[...evm].map(([chain, p]) => [chain, new EvmHolderIndex(p.rpc, p.erc20, { ...DEFAULT_EVM_INDEX, maxChunks: EVM_SCAN_CHUNKS[chain] })] as const),
  ]);
  gateway.setTokenMetrics(new TokenMetricsService((chain) => metricsSources.get(chain) ?? null));

  await quotes.start();
  await feed.start();
  // fomo page-layout overrides: edit DATA_DIR/fomo-dom.json and every extension picks it up within seconds.
  const fomoDomFile = join(dirname(cfg.dbPath), 'fomo-dom.json');
  const fomoDom = new FileFomoDomAdapter(fomoDomFile, logError('fomo-dom'));
  gateway.setFomoDom(fomoDom.current());
  fomoDom.start((overrides) => {
    gateway.setFomoDom(overrides);
    const n = overrides ? Object.keys(overrides).length : 0;
    log(`fomo layout overrides ${n ? `updated (${n} fields)` : 'cleared'} → pushed to extensions`);
    relay.record('server', `fomo layout overrides ${n ? `updated: ${Object.keys(overrides!).join(', ')}` : 'cleared (built-ins)'}`);
  });
  access.start((c) => {
    gateway.pushAccess();
    log(`access updated: public v${c.publicVersion}, ${c.earlyAccess.length} early access, ${Object.keys(c.freeUntil).length} free until a date`);
  });
  await gateway.listen();
  await engine.start();
  guard.start();
  await billing?.start();
  relay.start();
  relay.record('server', `server started · ${[...evm.keys()].length + 1} chains · paywall ${cfg.paywall ? `$${cfg.paywall.priceUsd}/${cfg.paywall.periodDays}d` : 'off'}`);
  if (!cfg.telegram) log('Telegram monitoring off (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID); activity is still logged to the database');
  if (!billing) log('paywall off (PAYWALL_ENABLED is not true)');
  log(`limit server on ws://${cfg.gatewayHost}:${gateway.port()}${cfg.trustProxy ? ' (behind Cloudflare)' : ''}`);
  log(`Owner account key (old pairing code): ${cfg.pairingToken}`);
  log(evm.size ? `EVM chains: ${[...evm.keys()].join(', ')}` : 'No EVM chains configured');

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    guard?.stop();
    relay.stop();
    fomoDom.stop();
    access.stop();
    outages.stop();
    await tickers.flush();
    await relay.deliver(); // flush what's queued
    billing?.stop();
    engine.stop();
    accountStore.close();
    activityStore.close();
    await gateway.close();
    await feed.close();
    quotes.close();
    for (const p of evm.values()) { p.quotes.close(); await p.rpc.close(); }
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
