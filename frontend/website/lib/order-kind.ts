/**
 * @file order-kind.ts
 * @description The same order-type rule the extension uses: a target below the live value waits for a drop,
 *              above waits for a rise; combined with buy/sell that gives the four order kinds.
 * @author Reborn1987
 */

export type Side = 'buy' | 'sell';

/** Order kind for a side and a % offset from the live market cap. */
export function orderKind(side: Side, percent: number): string {
  const below = percent < 0;
  if (side === 'buy') return below ? 'Limit buy' : 'Breakout buy';
  return below ? 'Stop loss' : 'Take profit';
}

/** One-line explanation shown under the slider. */
export function orderExplainer(side: Side, percent: number, targetLabel: string): string {
  const kind = orderKind(side, percent);
  const verb = side === 'buy' ? 'buys' : 'sells';
  const when = percent < 0 ? `drops to ${targetLabel}` : percent > 0 ? `rises to ${targetLabel}` : `is at ${targetLabel}`;
  return `${kind}: limit ${verb} the moment the market cap ${when}.`;
}
