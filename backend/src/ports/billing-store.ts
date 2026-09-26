/**
 * @file billing-store.ts
 * @description BillingStorePort — payments received, per-account unlocks, payment codes (invoices) and chain cursors.
 * @author Reborn1987
 */

/** A payment as recorded. `userId` is null while nobody could be matched to it. */
export interface PaymentRecord {
  /** `<chain>:<tx>:<sender>` — one credit per transaction and sender. */
  readonly id: string;
  readonly chain: string;
  readonly asset: string;
  readonly from: string;
  readonly amount: number;
  /** Credit toward the unlock, in USD at the USDC price (token payments include their discount). */
  readonly creditUsd: number;
  readonly userId: string | null;
  readonly receivedAt: number;
}

/** A payment code handed to an account: amounts ending in this code identify it. */
export interface Invoice {
  readonly userId: string;
  readonly code: number;
  /** Token price (USD) locked when the code was issued; null when no token quote was made. */
  readonly tokenPriceUsd: number | null;
  readonly expiresAt: number;
}

export abstract class BillingStorePort {
  /** Stores a payment; false when its id was already recorded (duplicate log / replay). */
  abstract addPayment(p: PaymentRecord): boolean;

  /** Total credit of an account. */
  abstract creditUsd(userId: string): number;

  /** Payments nobody could be matched to (for manual review). */
  abstract unmatched(): PaymentRecord[];

  /** When the account was unlocked, or null. */
  abstract unlockedAt(userId: string): number | null;

  /** Marks the account unlocked (no-op when already unlocked). */
  abstract unlock(userId: string, at: number): void;

  /** The account's invoice that is still valid at `now`, or null. */
  abstract activeInvoice(userId: string, now: number): Invoice | null;

  /** The valid invoice carrying `code` at `now`, or null. */
  abstract invoiceByCode(code: number, now: number): Invoice | null;

  /** Codes in use by valid invoices at `now`. */
  abstract codesInUse(now: number): Set<number>;

  /** Saves (replaces) the account's invoice. */
  abstract saveInvoice(inv: Invoice): void;

  /** Last processed position per chain (block number or signature). */
  abstract cursor(chain: string): string | null;
  abstract setCursor(chain: string, value: string): void;

  /** Deletes an account's billing data (account deletion). Payments stay, unassigned, for bookkeeping. */
  abstract forgetUser(userId: string): void;
}
