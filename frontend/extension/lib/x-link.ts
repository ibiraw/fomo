/**
 * @file x-link.ts
 * @description Turns an X link ("https://x.com/name", "x.com/name/status/1", "https://x.com/i/communities/123") into
 *              the account or community whose latest post limit reads. Mirror of the server's `parseTwitterLink`
 *              (backend/src/core/tokens/socials.ts); used for the X link fomo shows on a token page.
 * @author Reborn1987
 */

import type { TokenInfo } from './messages';

export type XLink = NonNullable<TokenInfo['twitter']>;

/** Paths on x.com that are not user handles. */
const RESERVED = new Set(['i', 'home', 'search', 'explore', 'intent', 'share', 'hashtag', 'settings', 'messages', 'notifications']);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** The X account / community a link points to (a post → its author), or null when it isn't a usable X link. */
export function parseXLink(raw: string): XLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|mobile\.)/, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'i' && parts[1] === 'communities' && parts[2] && /^\d+$/.test(parts[2])) {
    return { kind: 'community', url: `https://x.com/i/communities/${parts[2]}`, handle: null };
  }
  const handle = parts[0];
  if (!handle || RESERVED.has(handle.toLowerCase()) || !HANDLE_RE.test(handle)) return null;
  return { kind: parts[1] === 'status' ? 'tweet' : 'profile', url: `https://x.com/${handle}`, handle };
}
