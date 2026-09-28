/**
 * @file QuickTradeSettings.tsx
 * @description Settings → Quick buttons (v2.0.0): the amounts of the Buy / Buy / Sell buttons limit adds under fomo's
 *              Feed and Alerts items. Saved as you type once valid; the buttons on open fomo tabs update right away.
 * @author Reborn1987
 */

import { useEffect, useState } from 'react';

import { FieldBox } from '@/components/orders/FieldBox';
import { SettingsCard } from '@/components/SettingsCard';
import { DEFAULT_QUICK_PRESETS, QUICK_PRESETS_KEY, toQuickPresets, type QuickPresets } from '@/lib/quick-trade';

/** The three amounts, with the row of buttons they make. */
export function QuickTradeSettings() {
  const [saved, setSaved] = useState<QuickPresets>(DEFAULT_QUICK_PRESETS);
  const [draft, setDraft] = useState({ buyA: '', buyB: '', sellPct: '' });

  useEffect(() => {
    void browser.storage.local.get(QUICK_PRESETS_KEY).then((s) => {
      const p = toQuickPresets(s[QUICK_PRESETS_KEY]);
      setSaved(p);
      setDraft({ buyA: String(p.buyA), buyB: String(p.buyB), sellPct: String(p.sellPct) });
    });
  }, []);

  const buyOk = (v: string): boolean => Number(v) >= 2 && Number(v) <= 100_000;
  const pctOk = (v: string): boolean => Number(v) > 0 && Number(v) <= 100;
  const valid = { buyA: buyOk(draft.buyA), buyB: buyOk(draft.buyB), sellPct: pctOk(draft.sellPct) };

  /** Updates one field and saves all three when they're valid. */
  const change = (field: keyof typeof draft, v: string): void => {
    const next = { ...draft, [field]: v };
    setDraft(next);
    if (buyOk(next.buyA) && buyOk(next.buyB) && pctOk(next.sellPct)) {
      const p = { buyA: Number(next.buyA), buyB: Number(next.buyB), sellPct: Number(next.sellPct) };
      setSaved(p);
      void browser.storage.local.set({ [QUICK_PRESETS_KEY]: p });
    }
  };

  return (
    <SettingsCard className="space-y-2">
      <h2 className="text-sm font-semibold">Quick buttons</h2>
      <p className="text-xs text-muted-foreground">Under every post in fomo&apos;s Feed and Alerts. A tap trades right away, no confirmation.</p>
      <div className="grid grid-cols-3 gap-1.5">
        <FieldBox label="Buy" value={draft.buyA} onChange={(v) => change('buyA', v)} suffix={<span className="text-xs font-semibold">$</span>} className={valid.buyA ? '' : 'ring-1 ring-destructive'} />
        <FieldBox label="Buy" value={draft.buyB} onChange={(v) => change('buyB', v)} suffix={<span className="text-xs font-semibold">$</span>} className={valid.buyB ? '' : 'ring-1 ring-destructive'} />
        <FieldBox label="Sell" value={draft.sellPct} onChange={(v) => change('sellPct', v)} suffix={<span className="text-xs font-semibold">%</span>} className={valid.sellPct ? '' : 'ring-1 ring-destructive'} />
      </div>
      {!(valid.buyA && valid.buyB && valid.sellPct) && <p className="text-[11px] text-destructive">Buys: $2 to $100,000. Sell: 1 to 100%.</p>}
      <div className="flex flex-wrap gap-1.5" aria-label="Your buttons">
        <span className="rounded-md border border-buy/50 bg-buy/15 px-2 py-0.5 text-xs font-semibold text-buy">Buy ${saved.buyA}</span>
        <span className="rounded-md border border-buy/50 bg-buy/15 px-2 py-0.5 text-xs font-semibold text-buy">Buy ${saved.buyB}</span>
        <span className="rounded-md border border-sell/50 bg-sell/15 px-2 py-0.5 text-xs font-semibold text-sell">Sell {saved.sellPct}%</span>
      </div>
    </SettingsCard>
  );
}
