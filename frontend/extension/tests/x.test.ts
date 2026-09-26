/**
 * @file x.test.ts
 * @description Tests for the X latest-post scraper (against a simulated X timeline) and XLatestService.
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { timeAgo } from '../lib/format';
import { XLatestService, type XBrowserApi, type XTimings } from '../lib/x-latest';
import { scrapeLatestPost, type XScrapeResult } from '../lib/x-scraper';

/** One simulated X post article. */
function article(opts: { social?: string; handle?: string; id?: string; time?: string; text?: string; img?: string; promoted?: boolean }): string {
  const h = opts.handle ?? 'wojaccsolana';
  const timeHtml = opts.promoted ? '' : `<a href="https://x.com/${h}/status/${opts.id ?? '1'}"><time datetime="${opts.time ?? '2026-09-26T11:00:00.000Z'}">1h</time></a>`;
  return `<article data-testid="tweet">
    ${opts.social ? `<span data-testid="socialContext">${opts.social}</span>` : ''}
    ${timeHtml}
    <div data-testid="tweetText">${opts.text ?? 'gm'}</div>
    ${opts.img ? `<div data-testid="tweetPhoto"><img src="${opts.img}"></div>` : ''}
  </article>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('scrapeLatestPost', () => {
  it('skips pinned posts, reposts and promoted posts', async () => {
    document.body.innerHTML = [
      article({ social: 'Pinned', id: '9', text: 'old pinned' }),
      article({ social: 'woj reposted', id: '8' }),
      article({ promoted: true }),
      article({ id: '7', text: 'fresh post', time: '2026-09-26T11:50:00.000Z', img: 'https://pbs.twimg.com/media/a.jpg' }),
    ].join('');
    const r = await scrapeLatestPost(100);
    expect(r).toEqual({
      ok: true,
      post: { url: 'https://x.com/wojaccsolana/status/7', time: '2026-09-26T11:50:00.000Z', text: 'fresh post', author: 'wojaccsolana', image: 'https://pbs.twimg.com/media/a.jpg' },
    });
  });

  it('waits for the timeline to render', async () => {
    setTimeout(() => (document.body.innerHTML = article({ id: '5' })), 50);
    const r = await scrapeLatestPost(2_000);
    expect(r.ok && r.post.url).toBe('https://x.com/wojaccsolana/status/5');
  });

  it('reports login walls, unavailable accounts, only-pinned timelines and timeouts', async () => {
    document.body.innerHTML = '<a data-testid="loginButton">Log in</a>';
    expect(await scrapeLatestPost(50)).toMatchObject({ ok: false, reason: 'not_logged_in' });
    document.body.innerHTML = '<div data-testid="emptyState">This account doesn’t exist</div>';
    expect(await scrapeLatestPost(50)).toMatchObject({ ok: false, reason: 'unavailable', message: expect.stringMatching(/doesn’t exist/) });
    document.body.innerHTML = article({ social: 'Pinned' });
    expect(await scrapeLatestPost(50)).toMatchObject({ ok: false, reason: 'no_posts' });
    document.body.innerHTML = '';
    expect(await scrapeLatestPost(50)).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

const T: XTimings = { loadMs: 50, scrapeMs: 10, pollMs: 5, cacheMs: 1_000 };
const OK: XScrapeResult = { ok: true, post: { url: 'u', time: 't', text: '', author: 'a', image: null } };

/** Fake browser API with scriptable load status and scrape result. */
function fakeApi(opts: { status?: () => string; result?: () => XScrapeResult } = {}) {
  return {
    openWindow: vi.fn(async () => ({ windowId: 1, tabId: 2 })),
    closeWindow: vi.fn(async () => undefined),
    tabStatus: vi.fn(async () => (opts.status ? opts.status() : 'complete')),
    scrape: vi.fn(async () => (opts.result ? opts.result() : OK)),
  } satisfies XBrowserApi;
}

describe('XLatestService', () => {
  it('scrapes, closes the window, caches, and dedupes concurrent calls', async () => {
    const api = fakeApi();
    let now = 0;
    const svc = new XLatestService(api, T, () => now);
    const [a, b] = await Promise.all([svc.get('https://x.com/w'), svc.get('https://x.com/w')]);
    expect(a.result).toEqual(OK);
    expect(b).toBe(a);
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(api.closeWindow).toHaveBeenCalledWith(1);
    await svc.get('https://x.com/w');
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    await svc.get('https://x.com/w', true);
    now = 2_000;
    await svc.get('https://x.com/w');
    expect(api.openWindow).toHaveBeenCalledTimes(3);
  });

  it('times out slow loads without caching, and still closes the window', async () => {
    const api = fakeApi({ status: () => 'loading' });
    const svc = new XLatestService(api, T);
    expect((await svc.get('https://x.com/w')).result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(api.closeWindow).toHaveBeenCalled();
    await svc.get('https://x.com/w');
    expect(api.openWindow).toHaveBeenCalledTimes(2);
  });

  it('closes the window even when scraping throws', async () => {
    const api = fakeApi({ result: () => { throw new Error('boom'); } });
    await expect(new XLatestService(api, T).get('https://x.com/w')).rejects.toThrow('boom');
    expect(api.closeWindow).toHaveBeenCalled();
  });
});

describe('timeAgo', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(timeAgo('2026-09-26T11:59:55Z', now)).toBe('just now');
    expect(timeAgo('2026-09-26T11:59:15Z', now)).toBe('45s ago');
    expect(timeAgo('2026-09-26T11:48:00Z', now)).toBe('12m ago');
    expect(timeAgo('2026-09-26T09:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-09-24T12:00:00Z', now)).toBe('2d ago');
    expect(timeAgo('garbage', now)).toBe('unknown time');
  });
});
