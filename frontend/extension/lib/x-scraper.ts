/**
 * @file x-scraper.ts
 * @description Reads the newest original post from an X profile/community page using the user's own
 *              logged-in session. `scrapeLatestPost` is injected with chrome.scripting.executeScript, so it
 *              must stay fully self-contained (no imports, no outer variables).
 * @author Reborn1987
 */

/** One X post as shown to the user. */
export interface XPost {
  readonly url: string;
  /** ISO timestamp of the post. */
  readonly time: string;
  readonly text: string;
  readonly author: string;
  readonly image: string | null;
}

/** Scrape outcome (Service Result pattern). */
export type XScrapeResult =
  | { readonly ok: true; readonly post: XPost }
  | { readonly ok: false; readonly reason: 'not_logged_in' | 'unavailable' | 'no_posts' | 'timeout'; readonly message: string };

/**
 * Waits for the timeline and returns the first post that is not pinned and not a repost
 * (reposts show the original post's time, which would misstate the account's latest activity).
 * Self-contained: runs inside the x.com page.
 */
export async function scrapeLatestPost(timeoutMs: number): Promise<XScrapeResult> {
  const deadline = Date.now() + timeoutMs;
  const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+\n/g, '\n').trim();
  let sawArticles = false;
  while (Date.now() < deadline) {
    if (location.pathname.startsWith('/i/flow/login') || document.querySelector('[data-testid="loginButton"]')) {
      return { ok: false, reason: 'not_logged_in', message: 'Log in to x.com in this Chrome profile to see latest posts' };
    }
    const empty = document.querySelector('[data-testid="emptyState"]');
    if (empty) return { ok: false, reason: 'unavailable', message: clean(empty.textContent).slice(0, 140) || 'Account unavailable' };
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    sawArticles ||= articles.length > 0;
    for (const a of articles) {
      const social = a.querySelector('[data-testid="socialContext"]')?.textContent ?? '';
      if (/pinned|reposted/i.test(social)) continue;
      const time = a.querySelector('time');
      const link = time?.closest('a');
      if (!time || !link) continue; // promoted posts have no timestamp link
      const author = /^\/([^/]+)\/status\//.exec(new URL(link.href).pathname)?.[1] ?? '';
      const img = a.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img');
      return {
        ok: true,
        post: {
          url: link.href,
          time: time.getAttribute('datetime') ?? '',
          text: clean(a.querySelector('[data-testid="tweetText"]')?.textContent),
          author,
          image: img?.src ?? null,
        },
      };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return sawArticles
    ? { ok: false, reason: 'no_posts', message: 'Only pinned posts or reposts found' }
    : { ok: false, reason: 'timeout', message: 'X did not load in time' };
}
