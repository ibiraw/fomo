/**
 * @file token-key.test.ts
 * @description Token keys for Solana and fomo's EVM chains: parsing, page paths, URL matching and display.
 * @author Reborn1987
 */

import { describe, expect, it } from 'vitest';

import { isTokenPage, tokenUrl } from '../lib/fomo-tab';
import { mintFromFomoUrl, shortMint } from '../lib/format';
import { keyFromPath, parseTokenKey, tokenAddress, tokenPath } from '../lib/token-key';

const MINT = 'EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
const EVM = '0x41CA1A94F5262C4A84FAFDAA23B9499AA5B9FCD0';
const KEY = `robinhood:${EVM.toLowerCase()}`;

describe('token keys', () => {
  it('parses Solana mints and chain-prefixed EVM addresses', () => {
    expect(parseTokenKey(MINT)).toEqual({ chain: 'solana', address: MINT });
    expect(parseTokenKey(`robinhood:${EVM}`)).toEqual({ chain: 'robinhood', address: EVM.toLowerCase() });
    expect(parseTokenKey(`monad:${EVM}`)).toBeNull();
    expect(parseTokenKey('base:0x12')).toBeNull();
  });

  it('maps keys to fomo paths and back', () => {
    expect(tokenPath(MINT)).toBe(`/tokens/solana/${MINT}`);
    expect(tokenPath(KEY)).toBe(`/tokens/robinhood/${EVM.toLowerCase()}`);
    expect(tokenPath('garbage')).toBe('/tokens/solana/garbage');
    expect(keyFromPath(`/tokens/robinhood/${EVM}/`)).toBe(KEY);
    expect(keyFromPath(`/tokens/solana/${MINT}`)).toBe(MINT);
    expect(keyFromPath('/tokens/solana/0xabc')).toBeNull();
    expect(keyFromPath(`/tokens/monad/${EVM}`)).toBeNull();
    expect(keyFromPath('/profile/me')).toBeNull();
    expect(tokenAddress(KEY)).toBe(EVM.toLowerCase());
    expect(tokenAddress('garbage')).toBe('garbage');
  });

  it('recognises EVM token pages and URLs', () => {
    expect(tokenUrl(KEY)).toBe(`https://fomo.family/tokens/robinhood/${EVM.toLowerCase()}`);
    expect(isTokenPage(`https://fomo.family/tokens/robinhood/${EVM}?tradeId=1`, KEY)).toBe(true);
    expect(isTokenPage(`https://fomo.family/tokens/base/${EVM}`, KEY)).toBe(false);
    expect(isTokenPage(`https://fomo.family/tokens/robinhood/${EVM}`, 'garbage')).toBe(false);
    expect(mintFromFomoUrl(`https://fomo.family/tokens/bnb/${EVM}?x=1`)).toBe(`bnb:${EVM.toLowerCase()}`);
    expect(mintFromFomoUrl('https://example.com/tokens/solana/x')).toBeNull();
    expect(mintFromFomoUrl('not a url')).toBeNull();
    expect(mintFromFomoUrl(undefined)).toBeNull();
    expect(shortMint(KEY)).toBe('0x41…9fcd0');
  });
});
