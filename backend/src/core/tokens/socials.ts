/**
 * @file socials.ts
 * @description Parses the "twitter" field of token metadata into a normalized X link, and rewrites IPFS
 *              URIs to gateways that still serve raw files (ipfs.io no longer does, 2026-09).
 * @author Reborn1987
 */

/** A token's X presence: an account profile, a community, or a single post (whose author we then follow). */
export interface TwitterLink {
  readonly kind: 'profile' | 'community' | 'tweet';
  /** Page to read the latest post from (profile or community URL). */
  readonly url: string;
  /** Account handle when known (profile or tweet author). */
  readonly handle: string | null;
}

/** Paths on x.com that are not user handles. */
const RESERVED = new Set(['i', 'home', 'search', 'explore', 'intent', 'share', 'hashtag', 'settings', 'messages', 'notifications']);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Normalizes a metadata twitter value ("https://twitter.com/x", "x.com/x/status/1", "@x",
 * "https://x.com/i/communities/123") into a TwitterLink, or null when it is not a usable X link.
 */
export function parseTwitterLink(raw: unknown): TwitterLink | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('@') && HANDLE_RE.test(value.slice(1))) {
    const handle = value.slice(1);
    return { kind: 'profile', url: `https://x.com/${handle}`, handle };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
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
  const kind = parts[1] === 'status' ? 'tweet' : 'profile';
  return { kind, url: `https://x.com/${handle}`, handle };
}

/** Gateways that serve raw IPFS files, tried in order. */
export const IPFS_GATEWAYS = ['https://pump.mypinata.cloud/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://ipfs.4everland.io/ipfs/'];

/** Returns URLs to try for a metadata URI (gateway rewrites for IPFS, otherwise the URI itself). */
export function candidateUrls(uri: string): string[] {
  const m = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(uri) ?? /^https?:\/\/[^/]+\/ipfs\/(.+)$/i.exec(uri);
  if (!m) return /^https?:\/\//i.test(uri) ? [uri] : [];
  const path = m[1]!;
  return [...IPFS_GATEWAYS.map((g) => g + path), ...(/^https?:/i.test(uri) ? [uri] : [])];
}
