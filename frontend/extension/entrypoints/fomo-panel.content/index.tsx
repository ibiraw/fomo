/**
 * @file index.tsx
 * @description Content script adding a native-looking "Limit" tab next to FOMO's Buy/Sell tabs. The tab
 *              swaps FOMO's trade form for our limit-order view (React in a shadow root). Re-attaches
 *              itself whenever FOMO re-renders or navigates.
 * @author Reborn1987
 */

import '@/assets/theme.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReactDOM from 'react-dom/client';

import { LimitView, type MintStore } from '@/components/panel/LimitView';
import { loadDefaultTab, onDefaultTabChange, type DefaultTab } from '@/hooks/use-default-tab';
import { loadTheme, onThemeChange } from '@/hooks/use-theme';
import { appendViewAfter, ensureLimitTab, ensurePageStyle, LIMIT_HOST_TAG, setLimitActive, setPageTheme, VIEW_ATTR } from '@/lib/fomo-inject';
import { applyPanelVars, fomoOverrideCss, type Theme } from '@/lib/themes';
import { mintFromFomoUrl } from '@/lib/format';

/** Tiny external store holding the current page's mint. */
function createMintStore(): MintStore & { refresh(): void } {
  let mint = mintFromFomoUrl(location.href);
  const subs = new Set<() => void>();
  return {
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    get: () => mint,
    refresh() {
      const next = mintFromFomoUrl(location.href);
      if (next !== mint) { mint = next; subs.forEach((cb) => cb()); }
    },
  };
}

export default defineContentScript({
  matches: ['https://fomo.family/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  /** Keeps the Limit tab and view attached to FOMO's trade panel. */
  async main(ctx) {
    ensurePageStyle(document);
    // Theme: recolor fomo's page (its CSS variables) and our view; follow changes from the popup live.
    let theme: Theme = await loadTheme();
    const applyTheme = (): void => {
      setPageTheme(document, fomoOverrideCss(theme));
      const host = document.querySelector<HTMLElement>(LIMIT_HOST_TAG);
      if (host) applyPanelVars(host, theme);
    };
    applyTheme();
    const offTheme = onThemeChange((t) => { theme = t; applyTheme(); });
    // Which tab a token page opens on. Applied once per token so switching tabs by hand is respected.
    let defaultTab: DefaultTab = await loadDefaultTab();
    let openedTabFor: string | null = null;
    const offDefaultTab = onDefaultTabChange((t) => { defaultTab = t; });
    const mintStore = createMintStore();
    const queryClient = new QueryClient();
    let ui: Awaited<ReturnType<typeof createShadowRootUi<ReactDOM.Root>>> | null = null;
    let mountedIn: HTMLElement | null = null;
    let busy = false;

    /** Places the tab and (re)mounts the view after the current panel's tab row. */
    const sync = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        mintStore.refresh();
        const found = ensureLimitTab(document);
        const host = mountedIn?.querySelector(`[${VIEW_ATTR}] > ${LIMIT_HOST_TAG}`);
        if (!found) return;
        const mint = mintStore.get();
        if (mint && openedTabFor !== mint) {
          openedTabFor = mint;
          if (defaultTab === 'limit') setLimitActive(found.panel, true);
        }
        if (mountedIn === found.panel && host?.isConnected) return;
        ui?.remove();
        mountedIn?.querySelector(`[${VIEW_ATTR}]`)?.remove();
        ui = await createShadowRootUi(ctx, {
          name: LIMIT_HOST_TAG,
          position: 'inline',
          anchor: found.tabRow,
          append: appendViewAfter,
          onMount: (container) => {
            const app = document.createElement('div');
            app.className = 'text-foreground';
            // The shadow root resets inherited fonts; reuse FOMO's own font stack (Aeonik).
            app.style.fontFamily = getComputedStyle(document.body).fontFamily;
            container.append(app);
            const root = ReactDOM.createRoot(app);
            root.render(
              <QueryClientProvider client={queryClient}>
                <LimitView mintStore={mintStore} />
              </QueryClientProvider>,
            );
            return root;
          },
          onRemove: (root) => root?.unmount(),
        });
        ui.mount();
        mountedIn = found.panel;
        applyTheme();
      } finally {
        busy = false;
      }
    };

    // FOMO is a single-page app: re-check on DOM changes (debounced) and on client-side navigation.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; void sync(); }, 150);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.addEventListener(window, 'wxt:locationchange', schedule);
    ctx.onInvalidated(() => { observer.disconnect(); offTheme(); offDefaultTab(); ui?.remove(); });
    await sync();
  },
});
