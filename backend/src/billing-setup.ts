/**
 * @file billing-setup.ts
 * @description Composition for the paywall (used by index.ts): billing store and service, the platform token's live
 *              price, and a payment watcher per chain (Solana + every enabled EVM chain).
 * @author Reborn1987
 */

import { KitSolanaTransfersAdapter } from './adapters/solana/kit-solana-transfers.adapter.js';
import { SqliteBillingStoreAdapter } from './adapters/storage/sqlite-billing-store.adapter.js';
import type { AppConfig } from './config.js';
import { BillingService, type OrderCounts } from './core/billing/billing-service.js';
import { EvmPaymentWatcher } from './core/billing/evm-payment-watcher.js';
import { STABLE_ASSETS, type PaymentAsset } from './core/billing/payment-assets.js';
import { SolanaPaymentWatcher } from './core/billing/solana-payment-watcher.js';
import { parseTokenKey, type EvmChain } from './core/chains/token-key.js';
import type { Erc20Reader } from './core/evm/erc20.js';
import type { AccountStorePort } from './ports/account-store.js';
import type { EvmRpcPort, Hex } from './ports/evm-rpc.js';
import type { PriceFeedPort, PriceWatch } from './ports/price-feed.js';
import type { SolanaAccountsPort } from './ports/solana-accounts.js';

export interface BillingParts {
  readonly service: BillingService;
  readonly store: SqliteBillingStoreAdapter;
  start(): Promise<void>;
  stop(): void;
}

interface Deps {
  readonly cfg: AppConfig;
  readonly paywall: NonNullable<AppConfig['paywall']>;
  readonly accounts: AccountStorePort;
  readonly solana: SolanaAccountsPort;
  readonly evm: ReadonlyMap<EvmChain, { readonly rpc: EvmRpcPort; readonly erc20: Erc20Reader }>;
  readonly feed: PriceFeedPort;
  readonly orderCounts: (userId: string) => OrderCounts;
  readonly onChange: (userId: string) => void;
  readonly log: (msg: string) => void;
  /** Monitoring sink. */
  readonly activity: (kind: 'payment' | 'subscription', text: string) => void;
  /** Short id of an account for messages. */
  readonly who: (userId: string) => string;
  readonly logError: (ctx: string) => (err: unknown) => void;
  /** End of an account's free period (ms; friends in the access file), or null. */
  readonly freeUntil: (userId: string) => number | null;
}

/** Resolves the platform token's decimals and symbol from its chain. */
async function tokenAsset(key: string, d: Deps): Promise<PaymentAsset> {
  const ref = parseTokenKey(key);
  if (ref.chain === 'solana') {
    const supply = await d.solana.getMintSupply(ref.address);
    return { chain: 'solana', address: ref.address, symbol: 'TOKEN', decimals: supply.decimals, kind: 'token' };
  }
  const parts = d.evm.get(ref.chain);
  if (!parts) throw new Error(`PAY_TOKEN is on ${ref.chain}, which has no RPC configured`);
  const token = ref.address as Hex;
  const [decimals, symbol] = await Promise.all([parts.erc20.decimals(token), parts.erc20.symbol(token)]);
  return { chain: ref.chain, address: ref.address, symbol, decimals, kind: 'token' };
}

/** Builds the paywall; watchers start with start(). */
export async function buildBilling(d: Deps): Promise<BillingParts> {
  const store = new SqliteBillingStoreAdapter(d.cfg.dbPath);
  const token = d.paywall.token ? await tokenAsset(d.paywall.token, d) : null;
  let tokenPrice: number | null = null;
  let tokenWatch: PriceWatch | null = null;

  const service = new BillingService(
    store,
    d.accounts,
    { priceUsd: d.paywall.priceUsd, tokenPriceUsd: d.paywall.tokenPriceUsd, freeOrders: d.paywall.freeOrders, periodDays: d.paywall.periodDays },
    d.paywall.treasury,
    STABLE_ASSETS.filter((a) => a.chain === 'solana' || d.evm.has(a.chain as EvmChain)),
    token,
    () => tokenPrice,
    d.orderCounts,
    d.onChange,
    Date.now,
    d.freeUntil,
  );

  const receive = (t: Parameters<BillingService['receive']>[0]): void => {
    const amount = Number(t.amountRaw) / 10 ** t.asset.decimals;
    const { recorded, userId } = service.receive(t);
    if (!recorded) return; // seen before (e.g. a watcher rescan): already credited and announced
    const to = userId ? d.who(userId) : 'UNMATCHED (review / claim)';
    d.log(`payment ${t.chain} ${t.asset.symbol} from ${t.from.slice(0, 8)} → ${userId ? `account ${userId.slice(0, 8)}` : 'UNMATCHED (review)'}`);
    d.activity('payment', `${amount.toFixed(2)} ${t.asset.symbol} on ${t.chain} from ${t.from} → ${to} · tx ${t.txId}`);
    if (userId) {
      const s = service.status(userId);
      if (s.unlocked && s.paidUntil) d.activity('subscription', `${d.who(userId)} active until ${new Date(s.paidUntil).toISOString().slice(0, 10)}`);
      else if (!s.unlocked) d.activity('subscription', `${d.who(userId)} has $${s.creditUsd.toFixed(2)} of $${s.priceUsd} toward a month`);
    }
  };

  const assetsOn = (chain: string): PaymentAsset[] => [...STABLE_ASSETS.filter((a) => a.chain === chain), ...(token?.chain === chain ? [token] : [])];
  const watchers: { start(): void; stop(): void }[] = [
    new SolanaPaymentWatcher(new KitSolanaTransfersAdapter(d.cfg.rpcHttp), assetsOn('solana'), d.paywall.treasury.solana, store, receive, d.logError('pay:solana')),
    ...[...d.evm].map(([chain, p]) => new EvmPaymentWatcher(chain, p.rpc, assetsOn(chain), d.paywall.treasury.evm, store, receive, d.logError(`pay:${chain}`))),
  ];

  return {
    service,
    store,
    async start() {
      service.settleAll(); // payments recorded before a restart or a price change
      if (d.paywall.token) tokenWatch = await d.feed.watch(d.paywall.token, (tick) => { tokenPrice = tick.priceUsd; });
      for (const w of watchers) w.start();
      d.log(`paywall on: $${d.paywall.priceUsd} USDC or $${d.paywall.tokenPriceUsd} in ${token ? token.symbol : '(token not launched)'} per ${d.paywall.periodDays} days, ${d.paywall.freeOrders} free orders`);
    },
    stop() {
      for (const w of watchers) w.stop();
      tokenWatch?.stop();
      store.close();
    },
  };
}
