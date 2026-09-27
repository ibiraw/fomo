/**
 * @file fomo-health.test.ts
 * @description fomo self-check: the layout check on the (fake) trade panel, the digit-masked layout snapshot, the
 *              "new version → Reload" prompt, and the watcher's timing (settle, confirm before reporting, navigation,
 *              re-check after a settings change, one prompt report per page).
 * @author Reborn1987
 */

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setFomoDom } from '../lib/fomo-dom-config';
import { checkLayout, findNewVersionPrompt, layoutSnapshot } from '../lib/fomo-health';
import { FomoHealthWatcher, type FomoHealthMessage } from '../lib/fomo-health-watch';
import { mountFakeFomo } from './fake-fomo';

afterEach(() => {
  setFomoDom(null);
  document.body.innerHTML = '';
});

describe('checkLayout', () => {
  it('passes on the known panel and names what is missing after a "redesign"', async () => {
    mountFakeFomo(document, { cash: 120, position: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(checkLayout(document)).toEqual({ ok: true, missing: [] });
    document.getElementById('submit')!.className = 'btn-new';
    expect(checkLayout(document)).toEqual({ ok: false, missing: ['submit button'] });
    document.body.innerHTML = '<div><button>Acheter</button><input name="amount"></div>';
    expect(checkLayout(document)).toEqual({ ok: false, missing: ['trade panel (Buy tab + amount input)'] });
  });
});

describe('layoutSnapshot', () => {
  it('outlines the trade area (classes, labels, input attributes) with the balance digits masked, capped in size', async () => {
    mountFakeFomo(document, { cash: 1234.56, position: 0 });
    await new Promise((r) => setTimeout(r, 0));
    const snap = layoutSnapshot(document);
    expect(snap).toMatch(/button#tab-buy\.flex-1\.p-2\.rounded-lg.* "Buy"/);
    expect(snap).toMatch(/input.*placeholder="0"/);
    expect(snap).toMatch(/"\$####\.##"/); // the balance ($1234.56), masked
    expect(snap).not.toMatch(/1234/);
    document.body.innerHTML = `<div>${'<p>x</p>'.repeat(5000)}</div>`;
    expect(layoutSnapshot(document).length).toBeLessThan(12_100);
  });
});

describe('findNewVersionPrompt', () => {
  it("finds fomo's Reload button only on a new-version toast", () => {
    document.body.innerHTML = '<div class="toast"><span>A new version of fomo is available</span><button>Reload</button></div>';
    expect(findNewVersionPrompt(document)?.textContent).toBe('Reload');
    document.body.innerHTML = '<div><span>Chart</span><button>Reload</button></div>'; // some other Reload
    expect(findNewVersionPrompt(document)).toBeNull();
    setFomoDom({ reloadLabels: ['Recharger'], newVersionWords: ['nouvelle version'] });
    document.body.innerHTML = '<div><p>Nouvelle version disponible</p><button>Recharger</button></div>';
    expect(findNewVersionPrompt(document)).not.toBeNull();
  });
});

describe('FomoHealthWatcher', () => {
  let sent: FomoHealthMessage[];
  let path: string;
  let loggedIn: boolean;
  let watcher: FomoHealthWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    path = '/tokens/solana/EcwFm5TJ3zuBXnsT6DngXMAMfsfELhwGc9JFgeVWpump';
    loggedIn = true;
    watcher = new FomoHealthWatcher({
      doc: document, path: () => path, isTokenPage: (p) => p.startsWith('/tokens/'), loggedIn: () => loggedIn,
      send: (m) => sent.push(m), now: () => Date.now(),
    }, { tickMs: 1_000, promptEveryMs: 3_000, settleMs: 3_000, confirmMs: 2_000 });
  });
  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('reports a passing check once, after the page settles', async () => {
    mountFakeFomo(document, { cash: 50, position: 0 });
    watcher.start();
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([{ type: 'fomo.layout', ok: true, missing: [] }]);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
  });

  it('confirms a failure before reporting it (with a snapshot), and re-checks after a settings change', () => {
    document.body.innerHTML = '<div id="new"><button>Buy</button><input name="amount"></div>';
    watcher.start();
    vi.advanceTimersByTime(3_000); // first failing look → confirming
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'fomo.layout', ok: false, missing: ['trade panel (Buy tab + amount input)'] });
    expect((sent[0] as { snapshot: string }).snapshot).toMatch(/input name="amount"/);
    setFomoDom({ amountInput: 'input[name=amount]' }); // server fix arrives
    watcher.recheck();
    vi.advanceTimersByTime(2_000);
    expect(sent.at(-1)).toMatchObject({ ok: false }); // still not a full panel (no Sell tab etc.) — reported again
  });

  it('skips pages that are not token pages or when logged out, and re-checks after navigating', () => {
    mountFakeFomo(document, { cash: 50, position: 0 });
    loggedIn = false;
    watcher.start();
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    loggedIn = true;
    path = '/profile/ibiraw';
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    path = '/tokens/base/0x0cbf291ba052174879d90bf781df1a5f2bc5bb07';
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([{ type: 'fomo.layout', ok: true, missing: [] }]);
  });

  it('reports the new-version prompt once', () => {
    document.body.innerHTML = '<div><span>New version available</span><button>Reload</button></div>';
    path = '/';
    watcher.start();
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([{ type: 'fomo.newVersion' }]);
  });
});
