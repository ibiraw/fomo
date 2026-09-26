/**
 * @file vault-pair.ts
 * @description Pairs updates of an AMM's two vault balances. A swap changes both vaults but they arrive as
 *              separate notifications; pricing after only one would produce a false spike. Emits only when
 *              both readings share a slot, or after a timeout if they stay mismatched (e.g. a stray transfer).
 * @author Reborn1987
 */

/** Max wait for the second vault before emitting anyway (~1 Solana slot). */
export const PAIR_TIMEOUT_MS = 400;

/** Latest balance of one vault and the slot it was observed at. */
interface Reading {
  amount: bigint | null;
  slot: bigint;
}

export class VaultPair {
  private readonly a: Reading = { amount: null, slot: -1n };
  private readonly b: Reading = { amount: null, slot: -1n };
  private pending: NodeJS.Timeout | null = null;

  /** @param onPair called with (vault A, vault B) balances when a consistent pair is available */
  constructor(private readonly onPair: (a: bigint, b: bigint) => void, private readonly timeoutMs = PAIR_TIMEOUT_MS) {}

  /** Records vault A's balance at `slot`. */
  updateA(amount: bigint, slot: bigint): void {
    this.update(this.a, amount, slot);
  }

  /** Records vault B's balance at `slot`. */
  updateB(amount: bigint, slot: bigint): void {
    this.update(this.b, amount, slot);
  }

  /** Re-emits the current pair (e.g. when fees or the quote price changed). */
  refresh(): void {
    if (this.a.amount !== null && this.b.amount !== null) this.onPair(this.a.amount, this.b.amount);
  }

  /** Cancels a pending timeout. */
  stop(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
  }

  /** Stores a reading; emits now when slots match, else schedules a fallback emit. */
  private update(r: Reading, amount: bigint, slot: bigint): void {
    if (slot < r.slot) return; // stale, out-of-order notification
    r.amount = amount;
    r.slot = slot;
    if (this.a.slot === this.b.slot) this.emitNow();
    else if (!this.pending) this.pending = setTimeout(() => this.emitNow(), this.timeoutMs);
  }

  /** Emits the pair and clears the pending timeout. */
  private emitNow(): void {
    this.stop();
    this.refresh();
  }
}
