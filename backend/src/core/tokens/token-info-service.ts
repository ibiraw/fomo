/**
 * @file token-info-service.ts
 * @description Resolves a token's name, symbol and social links (X, website) from on-chain metadata
 *              and its off-chain JSON file. Results are cached.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';

import { AccountNotFoundError, FomoError } from '../errors.js';
import type { HttpJsonPort } from '../../ports/http-json.js';
import type { SolanaAccountsPort } from '../../ports/solana-accounts.js';
import { decodeMetaplexMetadata, decodeToken2022Metadata, deriveMetaplexMetadata, type TokenMetadata } from './metadata.js';
import { candidateUrls, parseTwitterLink, type TwitterLink } from './socials.js';

/** What the extension shows about a token. */
export interface TokenInfo {
  readonly mint: string;
  readonly name: string;
  readonly symbol: string;
  readonly twitter: TwitterLink | null;
  readonly website: string | null;
}

/** Cache lifetimes (ms). */
const HIT_TTL = 30 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
/** DexScreener token listing (free, no key). Teams register their socials there; FOMO shows the same links. */
const DEXSCREENER_TOKEN_URL = 'https://api.dexscreener.com/tokens/v1/solana/';

/** Socials from a DexScreener listing. */
interface ListedSocials {
  readonly twitter: TwitterLink | null;
  readonly website: string | null;
}

export class TokenInfoService {
  private readonly cache = new Map<string, { at: number; info: TokenInfo }>();
  private readonly inflight = new Map<string, Promise<TokenInfo>>();

  /** @param accounts RPC reads @param http JSON fetcher @param now clock */
  constructor(
    private readonly accounts: SolanaAccountsPort,
    private readonly http: HttpJsonPort,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns token info (cached 30 min). Concurrent calls for one mint share a single lookup. */
  async getInfo(mint: string): Promise<TokenInfo> {
    const hit = this.cache.get(mint);
    if (hit && this.now() - hit.at < HIT_TTL) return hit.info;
    let p = this.inflight.get(mint);
    if (!p) {
      p = this.load(mint).finally(() => this.inflight.delete(mint));
      this.inflight.set(mint, p);
    }
    const info = await p;
    this.cache.set(mint, { at: this.now(), info });
    return info;
  }

  /** On-chain metadata → JSON file → normalized socials, with DexScreener as fallback for missing links. */
  private async load(mint: string): Promise<TokenInfo> {
    const meta = await this.readMetadata(mint);
    const json = await this.fetchJson(meta.uri);
    const ext = json.extensions && typeof json.extensions === 'object' ? (json.extensions as Record<string, unknown>) : {};
    let twitter = parseTwitterLink(json.twitter) ?? parseTwitterLink(ext.twitter);
    let website = typeof json.website === 'string' && /^https?:\/\//i.test(json.website) ? json.website : null;
    if (!twitter || !website) {
      const listed = await this.fetchListedSocials(mint);
      twitter ??= listed.twitter;
      website ??= listed.website;
    }
    return { mint, name: meta.name, symbol: meta.symbol, twitter, website };
  }

  /** Socials registered on DexScreener. A lookup failure just means "none found" (it is a fallback). */
  private async fetchListedSocials(mint: string): Promise<ListedSocials> {
    let pairs: unknown;
    try {
      pairs = await this.http.getJson(DEXSCREENER_TOKEN_URL + mint, FETCH_TIMEOUT_MS);
    } catch {
      return { twitter: null, website: null };
    }
    let twitter: TwitterLink | null = null;
    let website: string | null = null;
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      const info = (pair as { info?: { socials?: { type?: unknown; url?: unknown }[]; websites?: { url?: unknown }[] } }).info;
      for (const s of info?.socials ?? []) if (!twitter && s.type === 'twitter') twitter = parseTwitterLink(s.url);
      for (const w of info?.websites ?? []) if (!website && typeof w.url === 'string' && /^https?:\/\//i.test(w.url)) website = w.url;
    }
    return { twitter, website };
  }

  /** Token-2022 metadata extension first, Metaplex account second. */
  private async readMetadata(mint: string): Promise<TokenMetadata> {
    const mintData = await this.accounts.getAccount(mint);
    if (!mintData) throw new AccountNotFoundError(`Token ${mint} not found`);
    const t22 = decodeToken2022Metadata(mintData);
    if (t22) return t22;
    const mpl = await this.accounts.getAccount(await deriveMetaplexMetadata(mint as Address));
    const meta = mpl ? decodeMetaplexMetadata(mpl) : null;
    if (!meta) throw new FomoError(`Token ${mint} has no metadata`);
    return meta;
  }

  /** Tries each candidate URL; returns the first JSON object. */
  private async fetchJson(uri: string): Promise<Record<string, unknown>> {
    const errors: string[] = [];
    for (const url of candidateUrls(uri)) {
      try {
        const json = await this.http.getJson(url, FETCH_TIMEOUT_MS);
        if (json && typeof json === 'object') return json as Record<string, unknown>;
        errors.push(`${url}: not a JSON object`);
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new FomoError(`Could not load token metadata from ${uri} (${errors.join('; ') || 'unsupported URI'})`);
  }
}
