/**
 * @file token-info.test.ts
 * @description Tests for metadata decoders, X link parsing, IPFS gateway rewriting and TokenInfoService.
 * @author Reborn1987
 */

import type { Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import { FomoError } from '../../src/core/errors.js';
import { decodeMetaplexMetadata, decodeToken2022Metadata, deriveMetaplexMetadata } from '../../src/core/tokens/metadata.js';
import { candidateUrls, parseTwitterLink } from '../../src/core/tokens/socials.js';
import { TokenInfoService } from '../../src/core/tokens/token-info-service.js';
import { HttpJsonPort } from '../../src/ports/http-json.js';
import { FakeAccounts } from '../helpers/fake-accounts.js';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';

/** Borsh string. */
function bstr(s: string): Uint8Array {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

/** Concatenates byte arrays. */
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Token-2022 mint with an unrelated extension followed by TokenMetadata. */
function t22Mint(name: string, symbol: string, uri: string): Uint8Array {
  const base = new Uint8Array(166);
  base[165] = 1;
  const other = cat(Uint8Array.from([3, 0, 2, 0]), Uint8Array.from([9, 9])); // type 3, len 2
  const value = cat(new Uint8Array(64), bstr(name), bstr(symbol), bstr(uri), new Uint8Array(4));
  const hdr = new Uint8Array(4);
  new DataView(hdr.buffer).setUint16(0, 19, true);
  new DataView(hdr.buffer).setUint16(2, value.length, true);
  return cat(base, other, hdr, value);
}

/** Metaplex metadata account bytes (null-padded strings like the real program). */
function metaplex(name: string, symbol: string, uri: string): Uint8Array {
  const pad = (s: string, n: number): string => s + '\0'.repeat(n - s.length);
  return cat(new Uint8Array(65), bstr(pad(name, 32)), bstr(pad(symbol, 10)), bstr(pad(uri, 200)));
}

/** JSON fetcher answering from a map; missing URLs reject. */
class FakeHttp extends HttpJsonPort {
  calls: string[] = [];
  constructor(private readonly docs: Record<string, unknown>) { super(); }
  async getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (!(url in this.docs)) throw new Error('HTTP 404');
    return this.docs[url];
  }
}

describe('metadata decoders', () => {
  it('reads Token-2022 TokenMetadata after other extensions', () => {
    expect(decodeToken2022Metadata(t22Mint('Wojak', 'woj/acc', 'ipfs://x'))).toEqual({ name: 'Wojak', symbol: 'woj/acc', uri: 'ipfs://x' });
  });

  it('returns null for classic mints, mints without the extension, and truncated data', () => {
    expect(decodeToken2022Metadata(new Uint8Array(82))).toBeNull();
    const noExt = new Uint8Array(170);
    noExt[165] = 1;
    expect(decodeToken2022Metadata(noExt)).toBeNull();
    const truncated = t22Mint('a', 'b', 'c').subarray(0, 240);
    expect(decodeToken2022Metadata(truncated)).toBeNull();
  });

  it('reads Metaplex metadata and trims padding', async () => {
    expect(decodeMetaplexMetadata(metaplex('KEK', 'KEK', 'https://m/1.json'))).toEqual({ name: 'KEK', symbol: 'KEK', uri: 'https://m/1.json' });
    expect(decodeMetaplexMetadata(new Uint8Array(10))).toBeNull();
    expect(await deriveMetaplexMetadata(MINT as Address)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe('parseTwitterLink', () => {
  it('normalizes profiles, tweets, communities and handles', () => {
    expect(parseTwitterLink('https://x.com/wojaccsolana')).toEqual({ kind: 'profile', url: 'https://x.com/wojaccsolana', handle: 'wojaccsolana' });
    expect(parseTwitterLink('https://twitter.com/abc/status/123?s=20')).toEqual({ kind: 'tweet', url: 'https://x.com/abc', handle: 'abc' });
    expect(parseTwitterLink('x.com/i/communities/1900')).toEqual({ kind: 'community', url: 'https://x.com/i/communities/1900', handle: null });
    expect(parseTwitterLink('@kek')).toEqual({ kind: 'profile', url: 'https://x.com/kek', handle: 'kek' });
    expect(parseTwitterLink('https://www.x.com/Kek_1/')?.handle).toBe('Kek_1');
  });

  it('rejects non-X links and junk', () => {
    for (const v of [null, 5, '', 'https://t.me/x', 'https://x.com/search?q=a', 'https://x.com/', 'not a url with spaces', 'https://x.com/this_handle_is_way_too_long']) {
      expect(parseTwitterLink(v)).toBeNull();
    }
  });
});

describe('candidateUrls', () => {
  it('rewrites IPFS URIs to working gateways', () => {
    const c = candidateUrls('https://ipfs.io/ipfs/bafk1');
    expect(c[0]).toBe('https://pump.mypinata.cloud/ipfs/bafk1');
    expect(c.at(-1)).toBe('https://ipfs.io/ipfs/bafk1');
    expect(candidateUrls('ipfs://bafk2')[0]).toBe('https://pump.mypinata.cloud/ipfs/bafk2');
    expect(candidateUrls('https://arweave.net/abc')).toEqual(['https://arweave.net/abc']);
    expect(candidateUrls('ar://abc')).toEqual([]);
  });
});

describe('TokenInfoService', () => {
  it('resolves Token-2022 metadata, falls through failing gateways, and caches', async () => {
    const accounts = new FakeAccounts();
    accounts.data.set(MINT, t22Mint('Wojak', 'woj/acc', 'https://ipfs.io/ipfs/bafk1'));
    const http = new FakeHttp({ 'https://gateway.pinata.cloud/ipfs/bafk1': { twitter: 'https://x.com/wojaccsolana', website: 'https://w.fun' } });
    let t = 0;
    const svc = new TokenInfoService(accounts, http, () => t);
    const info = await svc.getInfo(MINT);
    expect(info).toMatchObject({ name: 'Wojak', symbol: 'woj/acc', website: 'https://w.fun', twitter: { handle: 'wojaccsolana' } });
    expect(http.calls).toHaveLength(2); // first gateway failed
    await svc.getInfo(MINT);
    expect(http.calls).toHaveLength(2); // cached
    t = 31 * 60_000;
    await svc.getInfo(MINT);
    expect(http.calls).toHaveLength(4); // expired
  });

  it('falls back to Metaplex metadata and extensions.twitter', async () => {
    const accounts = new FakeAccounts();
    accounts.data.set(MINT, new Uint8Array(82));
    accounts.data.set(await deriveMetaplexMetadata(MINT as Address), metaplex('KEK', 'KEK', 'https://m/1.json'));
    const svc = new TokenInfoService(accounts, new FakeHttp({ 'https://m/1.json': { extensions: { twitter: '@kek' }, website: 'ftp://no' } }));
    expect(await svc.getInfo(MINT)).toMatchObject({ symbol: 'KEK', twitter: { handle: 'kek' }, website: null });
  });

  it('shares one lookup between concurrent calls', async () => {
    const accounts = new FakeAccounts();
    accounts.data.set(MINT, t22Mint('W', 'W', 'https://m/2.json'));
    const http = new FakeHttp({ 'https://m/2.json': {} });
    const svc = new TokenInfoService(accounts, http);
    const [a, b] = await Promise.all([svc.getInfo(MINT), svc.getInfo(MINT)]);
    expect(a).toEqual(b);
    expect(a.twitter).toBeNull();
    expect(http.calls).toHaveLength(1);
  });

  it('explains missing tokens, missing metadata and unreachable files', async () => {
    const accounts = new FakeAccounts();
    const svc = new TokenInfoService(accounts, new FakeHttp({ 'https://m/3.json': 'nope' }));
    await expect(svc.getInfo(MINT)).rejects.toThrow(/not found/);
    accounts.data.set(MINT, new Uint8Array(82));
    await expect(svc.getInfo(MINT)).rejects.toThrow(/no metadata/);
    accounts.data.set(MINT, t22Mint('W', 'W', 'https://m/3.json'));
    await expect(svc.getInfo(MINT)).rejects.toThrow(FomoError);
    await expect(svc.getInfo(MINT)).rejects.toThrow(/not a JSON object/);
  });
});

describe('FetchHttpJsonAdapter', () => {
  it('parses JSON and rejects non-2xx', async () => {
    const { FetchHttpJsonAdapter } = await import('../../src/adapters/http/fetch-http-json.adapter.js');
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"a":1}', { status: 200 }))
      .mockResolvedValueOnce(new Response('x', { status: 404 }));
    const http = new FetchHttpJsonAdapter();
    expect(await http.getJson('https://x', 1000)).toEqual({ a: 1 });
    await expect(http.getJson('https://x', 1000)).rejects.toThrow(/HTTP 404/);
    spy.mockRestore();
  });
});
