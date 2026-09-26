/**
 * @file PolicyBlock.tsx
 * @description One titled section of a legal page (privacy, policies), with an anchor id for deep links.
 * @author Reborn1987
 */

/** Titled block; `id` makes it linkable (e.g. /policies#refunds). */
export function PolicyBlock({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
