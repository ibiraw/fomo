/**
 * @file x-link.test.ts
 * @description The token's X link fomo shows on its page: parsing X URLs (profile, post → author, community, not X)
 *              and finding fomo's "Twitter" button while ignoring X links inside posts.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { readTokenXLink } from '../lib/fomo-dom';
import { parseXLink } from '../lib/x-link';

describe('parseXLink', () => {
  it('reads profiles, posts (their author) and communities, and rejects everything else', () => {
    expect(parseXLink('https://x.com/actuallylmthe/status/2104631438842724449')).toEqual({ kind: 'tweet', url: 'https://x.com/actuallylmthe', handle: 'actuallylmthe' });
    expect(parseXLink('https://twitter.com/Some_Coin')).toEqual({ kind: 'profile', url: 'https://x.com/Some_Coin', handle: 'Some_Coin' });
    expect(parseXLink('https://x.com/i/communities/1234')).toEqual({ kind: 'community', url: 'https://x.com/i/communities/1234', handle: null });
    expect(parseXLink('https://x.com/search?q=LCAP')).toBeNull();
    expect(parseXLink('https://example.com/x')).toBeNull();
    expect(parseXLink('not a url')).toBeNull();
  });
});

describe('readTokenXLink', () => {
  it("finds fomo's Twitter button and ignores X links posted in the feed", () => {
    document.body.innerHTML = `
      <div class="post"><a href="https://x.com/realtrumanworld?s=11">https://x.com/realtrumanworld?s=11</a></div>
      <div class="about"><a href="https://example.com">Website</a><a href="https://x.com/actuallylmthe/status/1">Twitter</a><a href="https://x.com/search?q=LCAP">Search on X</a></div>`;
    expect(readTokenXLink(document)).toBe('https://x.com/actuallylmthe/status/1');
    document.body.innerHTML = '<a href="https://example.com/twitter">Twitter</a>';
    expect(readTokenXLink(document)).toBeNull();
  });
});
