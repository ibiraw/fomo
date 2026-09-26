/**
 * @file main.tsx
 * @description Single-file build of the site (Vite + vite-plugin-singlefile) for hosts that serve one page,
 *              such as a Claude artifact. Renders the same components as the Next.js app; site links
 *              (/policies, /privacy, /#section) switch pages in place because the host serves only one URL.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import Home from '@/app/page';
import Policies from '@/app/policies/page';
import Privacy from '@/app/privacy/page';
import { Splash } from '@/components/site/Splash';

import './single.css';

const PAGES = { home: Home, policies: Policies, privacy: Privacy } as const;
type Page = keyof typeof PAGES;

/** Page named by a bare #anchor in the artifact link (#policies, #privacy), else home. */
function initialPage(): Page {
  const hash = location.hash.slice(1);
  return hash === 'policies' || hash === 'privacy' ? hash : 'home';
}

/** Jumps (no smooth scroll: it's a page switch) to a section id, or to the top when it isn't on the page. */
function scrollTo(id: string) {
  const el = id ? document.getElementById(id) : null;
  if (el) el.scrollIntoView({ behavior: 'instant' });
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

/** Renders the current page and turns same-site link clicks into page switches. */
function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const [target, setTarget] = useState<{ id: string } | null>(null);

  useEffect(() => {
    /** Intercepts /path and /#section links; plain #section links on the current page scroll natively. */
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a');
      const href = a?.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      e.preventDefault();
      const [path, id = ''] = href.split('#');
      const next = path.slice(1);
      setPage(next in PAGES ? (next as Page) : 'home');
      setTarget({ id });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (target) scrollTo(target.id);
  }, [target, page]);

  const Current = PAGES[page];
  return <Current />;
}

createRoot(document.getElementById('root')!).render(
  <>
    <Splash />
    <App />
  </>,
);
