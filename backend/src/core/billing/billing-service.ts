/**
 * @file billing-service.ts
 * @description The unlock: a one-time payment in USDC (USDG on Robinhood) on any supported chain, or — once it exists —
 *              the platform token at a discount. New accounts get a few free orders first.
 *
 *              Matching a payment to an account:
 *              1. Sent from a wallet an account uses on fomo (read from the user's fomo login) → that account.
 *              2. Otherwise the amount's last digits carry the account's payment code (e.g. 50.004137 USDC → code 4137,
 *                 or 1,234.4137 tokens → code 4137).
 *              3. Otherwise it is kept as unmatched for manual review.
 *              Payments add up; the account unlocks once its credit reaches the price.
 * @author Reborn1987
 */

import { FomoError } from '../errors.js';
import type { AccountStorePort } from '../../ports/account-store.js';
import type { BillingStorePort, Invoice } from '../../ports/billing-store.js';
import type { PaymentAsset } from './payment-assets.js';

/** Prices and trial. */
export interface Plan {
  /** Unlock price in USDC. */
  readonly priceUsd: number;
  /** Unlock price when paying in the platform token (USD value at its live price). */
  readonly tokenPriceUsd: number;
  /** Orders an account may place before unlocking. */
  readonly freeOrders: number;
}

/** Where payments go. */
export interface Treasury {
  readonly solana: string;
  readonly evm: string;
}

/** A transfer into the treasury, as seen on-chain. */
export interface IncomingTransfer {
  readonly chain: string;
  readonly txId: string;
  readonly from: string;
  readonly asset: PaymentAsset;
  readonly amountRaw: bigint;
}

/** How to pay on one chain / coin. */
export interface PaymentMethod {
  readonly chain: string;
  readonly symbol: string;
  readonly kind: 'stable' | 'token';
  readonly payTo: string;
  /** Exact amount to send when paying from a wallet that isn't your fomo wallet. */
  readonly amount: string;
}

/** An account's orders as the trial sees them. */
export interface OrderCounts {
  /** Orders that filled (each uses one free order). */
  readonly filled: number;
  /** Orders placed and not finished yet (open / triggered / executing). */
  readonly waiting: number;
}

export interface BillingStatus {
  readonly unlocked: boolean;
  /** Free orders not yet used by a fill. */
  readonly freeOrdersLeft: number;
  /** Of those, how many are taken by orders still waiting to fill. */
  readonly freeOrdersWaiting: number;
  readonly creditUsd: number;
  readonly priceUsd: number;
  readonly tokenPriceUsd: number;
}

export interface BillingQuote extends BillingStatus {
  readonly code: number;
  readonly expiresAt: number;
  readonly methods: readonly PaymentMethod[];
}

/** Thrown when an account has used its free orders and hasn't unlocked. */
export class PaymentRequiredError extends FomoError {}

/** Codes run 1..9999 (the last 4 digits after the price). */
const MAX_CODE = 9_999;
/** A payment code stays valid this long after it was last shown. */
export const INVOICE_TTL_MS = 24 * 60 * 60_000;
/** Credit within 2% of the price unlocks (token prices move while the transfer confirms). */
const UNLOCK_TOLERANCE = 0.98;

/** Amount in whole units (float) from raw units. */
function units(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Raw amount rescaled to `digits` decimal places (truncated). */
function scaled(raw: bigint, decimals: number, digits: number): bigint {
  return decimals >= digits ? raw / 10n ** BigInt(decimals - digits) : raw * 10n ** BigInt(digits - decimals);
}

export class BillingService {
  /**
   * @param store billing storage @param accounts account storage (wallet lookup)
   * @param plan prices and trial @param treasury receiving wallets
   * @param stables accepted stablecoins @param token the platform token once launched (null before)
   * @param tokenUsd live USD price of the token (null when unknown)
   * @param orderCounts an account's filled and waiting orders (only fills use up free orders)
   * @param onChange called with the account id whenever its billing changes
   */
  constructor(
    private readonly store: BillingStorePort,
    private readonly accounts: AccountStorePort,
    private readonly plan: Plan,
    private readonly treasury: Treasury,
    private readonly stables: readonly PaymentAsset[],
    private readonly token: PaymentAsset | null,
    private readonly tokenUsd: () => number | null,
    private readonly orderCounts: (userId: string) => OrderCounts,
    private readonly onChange: (userId: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Throws PaymentRequiredError when the account may not place another order. Only fills use up free orders, but
   * waiting orders reserve one each, so the trial can never fill more than its free orders.
   */
  assertCanPlaceOrder(userId: string): void {
    if (this.store.unlockedAt(userId) !== null) return;
    const { filled, waiting } = this.orderCounts(userId);
    if (filled + waiting < this.plan.freeOrders) return;
    if (filled >= this.plan.freeOrders) {
      throw new PaymentRequiredError(`You've used your ${this.plan.freeOrders} free orders. Unlock auto fomo in Settings to keep placing orders.`);
    }
    const left = this.plan.freeOrders - filled;
    throw new PaymentRequiredError(
      `Your ${left} free ${left === 1 ? 'order is' : 'orders are'} waiting to fill. Cancel one or unlock auto fomo in Settings to place more.`,
    );
  }

  /** Unlock state and credit. */
  status(userId: string): BillingStatus {
    const unlocked = this.store.unlockedAt(userId) !== null;
    const { filled, waiting } = unlocked ? { filled: 0, waiting: 0 } : this.orderCounts(userId);
    const left = unlocked ? 0 : Math.max(0, this.plan.freeOrders - filled);
    return {
      unlocked,
      freeOrdersLeft: left,
      freeOrdersWaiting: Math.min(left, waiting),
      creditUsd: this.store.creditUsd(userId),
      priceUsd: this.plan.priceUsd,
      tokenPriceUsd: this.plan.tokenPriceUsd,
    };
  }

  /** Status plus how to pay: the account's payment code (issued or renewed) and one method per chain / coin. */
  quote(userId: string): BillingQuote {
    const now = this.now();
    const existing = this.store.activeInvoice(userId, now);
    const tokenPrice = this.token ? this.tokenUsd() : null;
    const invoice: Invoice = {
      userId,
      code: existing?.code ?? this.freeCode(now),
      tokenPriceUsd: tokenPrice ?? existing?.tokenPriceUsd ?? null,
      expiresAt: now + INVOICE_TTL_MS,
    };
    this.store.saveInvoice(invoice);

    const seen = new Set<string>();
    const methods: PaymentMethod[] = [];
    for (const a of this.stables) {
      const key = `${a.chain}:${a.symbol}`;
      if (seen.has(key)) continue; // e.g. Arc's two USDC log sources are one way to pay
      seen.add(key);
      methods.push({ chain: a.chain, symbol: a.symbol, kind: 'stable', payTo: this.payTo(a.chain), amount: (this.plan.priceUsd + invoice.code / 1e6).toFixed(6) });
    }
    if (this.token && invoice.tokenPriceUsd) {
      const whole = Math.ceil(this.plan.tokenPriceUsd / invoice.tokenPriceUsd);
      methods.push({ chain: this.token.chain, symbol: this.token.symbol, kind: 'token', payTo: this.payTo(this.token.chain), amount: (whole + invoice.code / 1e4).toFixed(4) });
    }
    return { ...this.status(userId), code: invoice.code, expiresAt: invoice.expiresAt, methods };
  }

  /**
   * Records a transfer into the treasury and credits the matching account (unlocking it at the price).
   * Returns the credited account id, or null when unmatched or already recorded.
   */
  receive(t: IncomingTransfer): string | null {
    const now = this.now();
    const userId = this.matchUser(t, now);
    const creditUsd = userId ? this.creditFor(t, userId, now) : 0;
    const stored = this.store.addPayment({
      id: `${t.chain}:${t.txId}:${t.from.toLowerCase()}`,
      chain: t.chain,
      asset: t.asset.address,
      from: t.from,
      amount: units(t.amountRaw, t.asset.decimals),
      creditUsd: creditUsd ?? 0,
      userId: creditUsd === null ? null : userId,
      receivedAt: now,
    });
    if (!stored || !userId || creditUsd === null) return null;
    if (this.store.unlockedAt(userId) === null && this.store.creditUsd(userId) >= this.plan.priceUsd * UNLOCK_TOLERANCE) {
      this.store.unlock(userId, now);
    }
    this.onChange(userId);
    return userId;
  }

  /** Unlocks an account without payment (the owner, testers, manual review). */
  grant(userId: string): void {
    this.store.unlock(userId, this.now());
    this.onChange(userId);
  }

  /** Account deletion. */
  forget(userId: string): void {
    this.store.forgetUser(userId);
  }

  /**
   * Account for a transfer: the payment code in the amount first (it names one account exactly), then the sender's
   * fomo wallet. Several accounts can share a wallet (e.g. two browsers): a still-locked one that asked how to pay
   * wins, then any still-locked one, then the most recently active.
   */
  private matchUser(t: IncomingTransfer, now: number): string | null {
    const code = this.codeIn(t);
    const byCode = code === null ? null : this.store.invoiceByCode(code, now);
    if (byCode) return byCode.userId;
    const candidates = this.accounts.findByWallet(t.chain === 'solana' ? 'solana' : 'evm', t.chain === 'solana' ? t.from : t.from.toLowerCase());
    const locked = candidates.filter((a) => this.store.unlockedAt(a.id) === null);
    return (locked.find((a) => this.store.activeInvoice(a.id, now) !== null) ?? locked[0] ?? candidates[0])?.id ?? null;
  }

  /** Payment code carried by the amount, or null. */
  private codeIn(t: IncomingTransfer): number | null {
    if (t.asset.kind === 'stable') {
      const micro = scaled(t.amountRaw, t.asset.decimals, 6) - BigInt(Math.round(this.plan.priceUsd * 1e6));
      return micro >= 1n && micro <= BigInt(MAX_CODE) ? Number(micro) : null;
    }
    const code = Number(scaled(t.amountRaw, t.asset.decimals, 4) % 10_000n);
    return code >= 1 ? code : null;
  }

  /** USD credit toward the USDC price; null when a token payment can't be priced (kept for manual review). */
  private creditFor(t: IncomingTransfer, userId: string, now: number): number | null {
    const amount = units(t.amountRaw, t.asset.decimals);
    if (t.asset.kind === 'stable') return amount;
    const price = this.store.activeInvoice(userId, now)?.tokenPriceUsd ?? this.tokenUsd();
    if (!price) return null;
    // Token payments get the discount: $35 of token counts as the full $50.
    return amount * price * (this.plan.priceUsd / this.plan.tokenPriceUsd);
  }

  /** Treasury wallet for a chain. */
  private payTo(chain: string): string {
    return chain === 'solana' ? this.treasury.solana : this.treasury.evm;
  }

  /** A code not used by any valid invoice. */
  private freeCode(now: number): number {
    const used = this.store.codesInUse(now);
    if (used.size >= MAX_CODE) throw new FomoError('No payment codes left right now — try again later.');
    for (;;) {
      const code = 1 + Math.floor(Math.random() * MAX_CODE);
      if (!used.has(code)) return code;
    }
  }
}
