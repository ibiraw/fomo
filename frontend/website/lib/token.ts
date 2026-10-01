/**
 * @file token.ts
 * @description The official $LIMIT token. Empty `ca` = not launched: the site shows "No token yet" instead of a CA.
 *              Set `ca` (and keep the server's PAY_TOKEN the same) when it launches.
 * @author Reborn1987
 */

export const LIMIT_TOKEN = {
  /** Contract address (Solana mint). Empty until launch. */
  ca: '',
  symbol: 'LIMIT',
  name: 'limit',
  chain: 'Solana',
  launchpad: 'Hooked',
  /** USD worth of the token that pays a month (server UNLOCK_TOKEN_PRICE_USD). */
  monthUsd: 30,
} as const;

/** True once the CA is set. */
export const tokenLive = (): boolean => LIMIT_TOKEN.ca.length > 0;

/** Solscan page for the token. */
export const solscanUrl = (): string => `https://solscan.io/token/${LIMIT_TOKEN.ca}`;
