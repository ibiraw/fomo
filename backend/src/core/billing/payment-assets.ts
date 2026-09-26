/**
 * @file payment-assets.ts
 * @description Coins accepted for the unlock, by exact contract address (verified on-chain 2026-09-26). Anything else
 *              named "USDC" is ignored — e.g. Robinhood Chain has look-alike "USDC" tokens but no real USDC, so USDG
 *              is accepted there. Arc's gas coin is USDC: plain transfers are logged by a system address with 18
 *              decimals, and ERC-20 transfers usually appear in both logs (payments are de-duplicated per transaction).
 * @author Reborn1987
 */

import type { Chain } from '../chains/token-key.js';

/** One accepted coin on one chain. */
export interface PaymentAsset {
  readonly chain: Chain;
  /** Mint (Solana) or contract / log emitter address (EVM, lowercase). */
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  /** 'stable' counts 1:1 in USD; 'token' is the platform token, priced live. */
  readonly kind: 'stable' | 'token';
}

export const STABLE_ASSETS: readonly PaymentAsset[] = [
  { chain: 'solana', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6, kind: 'stable' },
  { chain: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6, kind: 'stable' },
  { chain: 'base', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, kind: 'stable' },
  { chain: 'bnb', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', decimals: 18, kind: 'stable' },
  { chain: 'robinhood', address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', decimals: 6, kind: 'stable' },
  { chain: 'arc', address: '0x3600000000000000000000000000000000000000', symbol: 'USDC', decimals: 6, kind: 'stable' },
  // Arc native USDC (gas coin) transfers: logged by this system address, 18 decimals.
  { chain: 'arc', address: '0xfffffffffffffffffffffffffffffffffffffffe', symbol: 'USDC', decimals: 18, kind: 'stable' },
];
