/**
 * @file fomo-username.test.ts
 * @description Reading the logged-in user's fomo username from their profile link in fomo's top bar.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { readOwnFomoUsername } from '../lib/fomo-dom';

/** Top bar as observed on fomo 2026-09-27: the account button holds the profile link with the 24h PnL. */
const topBar = (href: string): string =>
  `<ul class="group flex-1 list-none"><li class="relative flex shrink-0"><button class="group inline-flex items-center"><a class="flex gap-2 items-center" href="${href}"><img alt="">+$40.15 24h</a></button></li></ul>`;

describe('readOwnFomoUsername', () => {
  it("reads the name from the top bar's profile link", () => {
    document.body.innerHTML = topBar('/profile/ibiraw');
    expect(readOwnFomoUsername(document)).toBe('ibiraw');
    document.body.innerHTML = topBar('/profile/some.name_2?tab=positions');
    expect(readOwnFomoUsername(document)).toBe('some.name_2');
  });

  it('ignores other people’s profile links (feed, holders) and logged-out pages', () => {
    document.body.innerHTML = '<div><a class="min-w-0 flex-1 rounded-lg" href="/profile/someoneelse">someone</a></div>';
    expect(readOwnFomoUsername(document)).toBeNull();
    document.body.innerHTML = '';
    expect(readOwnFomoUsername(document)).toBeNull();
  });

  it('rejects anything that is not a username', () => {
    for (const bad of ['/profile/', "/profile/x'%20OR%201=1", `/profile/${'a'.repeat(41)}`, '/profile/%3Cscript%3E']) {
      document.body.innerHTML = topBar(bad);
      expect(readOwnFomoUsername(document)).toBeNull();
    }
  });
});
