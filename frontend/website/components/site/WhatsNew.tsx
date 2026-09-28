/**
 * @file WhatsNew.tsx
 * @description "What's new": the public releases, newest first (from lib/releases.ts).
 * @author Reborn1987
 */

import { CHANGELOG, isReleased } from '@/lib/releases';
import { SectionHead } from './Sections';

/** "Sep 28, 2026" from "2026-09-28" (fixed to UTC so the static build and the browser agree). */
const longDate = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Release notes. */
export function WhatsNew() {
  const entries = CHANGELOG.filter((e) => isReleased(e.version));
  return (
    <section id="updates" className="mx-auto max-w-3xl px-5 py-24">
      <SectionHead eyebrow="What's new" title="Updates" sub="limit is actively built. New features land here first." />
      <ol className="space-y-4">
        {entries.map((e) => (
          <li key={e.version} className="rounded-2xl border bg-card p-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-sm font-bold text-brand tabular-nums">v{e.version}</span>
              <h3 className="font-semibold">{e.title}</h3>
              <time dateTime={e.date} className="ml-auto text-xs text-muted-foreground tabular-nums">{longDate(e.date)}</time>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {e.items.map((item) => <li key={item}>· {item}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
