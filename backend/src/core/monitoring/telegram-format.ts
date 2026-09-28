/**
 * @file telegram-format.ts
 * @description Turns one plain monitoring line into Telegram HTML: an entry's token line ("<network heart> <address>")
 *              becomes a short address ("FaoGhq…WJpump", first and last 6) linking to the token on fomo; other contract
 *              / wallet addresses become tap-to-copy `<code>` spans, "@name" fomo usernames link to the user's fomo
 *              profile, and "**TEXT**" becomes bold (the transaction type). Everything else is escaped, so text from
 *              users can never inject markup.
 * @author Reborn1987
 */

import { HEART_CHAIN } from './token-line.js';

/** fomo profile URL for a username. */
export const fomoProfileUrl = (name: string): string => `https://fomo.family/profile/${encodeURIComponent(name)}`;

/** fomo token page URL for a chain and address. */
export const fomoTokenUrl = (chain: string, address: string): string => `https://fomo.family/tokens/${chain}/${address}`;

/** "FaoGhq…WJpump": the first and last 6 characters. */
export const shortAddress = (address: string): string => (address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address);

/** Escapes the three characters Telegram's HTML mode cares about. */
function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Addresses (EVM 0x…40 hex, with or without a "chain:" prefix, and Solana base58 32–44) and fomo usernames.
 * Whole words only, so longer strings (transaction signatures, privy ids) are left alone.
 */
const TOKEN_RE = /(?<heart>💜|💙|🩵|💛|💚|🩶) (?<haddr>0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?![\w])|\*\*(?<bold>[^*\n]{1,40})\*\*|(?<![\w:])(?:(?<chain>ethereum|base|bnb|robinhood|arc):)?(?<evm>0x[0-9a-fA-F]{40})(?![\w])|(?<![\w])(?<sol>[1-9A-HJ-NP-Za-km-z]{32,44})(?![\w])|(?<![\w@])@(?<user>[A-Za-z0-9_.-]{1,40})(?![\w])/g;

/** One monitoring line as Telegram HTML. */
export function telegramHtml(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const g = m.groups ?? {};
    out += escape(line.slice(last, m.index));
    if (g.heart && g.haddr) out += `${g.heart} <a href="${fomoTokenUrl(HEART_CHAIN[g.heart]!, g.haddr)}">${shortAddress(g.haddr)}</a>`;
    else if (g.bold) out += `<b>${escape(g.bold)}</b>`;
    else if (g.evm) out += `${g.chain ? `${g.chain} ` : ''}<code>${g.evm}</code>`;
    else if (g.sol) out += `<code>${g.sol}</code>`;
    else if (g.user) out += `<a href="${fomoProfileUrl(g.user)}">@${escape(g.user)}</a>`;
    last = m.index + m[0].length;
  }
  return out + escape(line.slice(last));
}

/** Removes the markup telegramHtml added (fallback when Telegram rejects the HTML). */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
