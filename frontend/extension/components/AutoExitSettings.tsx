/**
 * @file AutoExitSettings.tsx
 * @description Settings → Auto TP/SL (v2.1.0): after a buy, limit places a take profit and a stop loss by itself.
 *              On/off, which buys get them (limit, quick buttons, buys made by hand on fomo), take profit +X% selling
 *              Y%, stop loss −X% selling Y% (fixed, or trailing under the high). Kept on the server (it places the
 *              orders); toggles save at once, typed numbers once valid (after a short pause).
 * @author Reborn1987
 */

import { useEffect, useRef, useState } from 'react';

import { FieldBox } from '@/components/orders/FieldBox';
import { Segmented } from '@/components/orders/Segmented';
import { SettingsCard } from '@/components/SettingsCard';
import type { SendFn } from '@/hooks/use-background';
import { MAX_TRAIL_PCT, MIN_TRAIL_PCT, type AutoExitSettings as Settings } from '@/lib/types';
import { cn } from '@/lib/utils';

type Draft = { tp: string; tpSell: string; sl: string; slSell: string };

const draftOf = (s: Settings): Draft => ({ tp: String(s.takeProfit.pct), tpSell: String(s.takeProfit.sellPct), sl: String(s.stopLoss.pct), slSell: String(s.stopLoss.sellPct) });
const sellOk = (v: string): boolean => Number(v) > 0 && Number(v) <= 100;
const tpOk = (v: string): boolean => Number(v) >= 1 && Number(v) <= 10_000;
const slOk = (v: string): boolean => Number(v) >= MIN_TRAIL_PCT && Number(v) <= MAX_TRAIL_PCT;

/** A tappable checkbox chip. */
function Check({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('flex-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors', on ? 'border-primary bg-primary/15 text-primary' : 'border-input text-muted-foreground hover:text-foreground')}
    >
      {on ? '✓ ' : ''}{label}
    </button>
  );
}

/** The auto take profit / stop loss card. */
export function AutoExitSettings({ send }: { send: SendFn }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    send({ type: 'autoExit.get' })
      .then((s) => { setSaved(s as Settings); setDraft(draftOf(s as Settings)); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [send]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const save = (next: Settings): void => {
    setSaved(next);
    send({ type: 'autoExit.set', settings: next })
      .then((s) => { setSaved(s as Settings); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  if (!saved || !draft) {
    return (
      <SettingsCard className="space-y-1">
        <h2 className="text-sm font-semibold">Auto TP/SL</h2>
        <p className="text-xs text-muted-foreground">{error ?? 'Loading…'}</p>
      </SettingsCard>
    );
  }

  const valid = { tp: tpOk(draft.tp), tpSell: sellOk(draft.tpSell), sl: slOk(draft.sl), slSell: sellOk(draft.slSell) };
  /** Updates a typed number and saves (after a pause) once all four are valid. */
  const type = (field: keyof Draft, v: string): void => {
    const next = { ...draft, [field]: v };
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    if (!(tpOk(next.tp) && sellOk(next.tpSell) && slOk(next.sl) && sellOk(next.slSell))) return;
    timer.current = setTimeout(() => save({
      ...saved,
      takeProfit: { ...saved.takeProfit, pct: Number(next.tp), sellPct: Number(next.tpSell) },
      stopLoss: { ...saved.stopLoss, pct: Number(next.sl), sellPct: Number(next.slSell) },
    }), 600);
  };
  const box = (ok: boolean): string => (ok ? '' : 'ring-1 ring-destructive');

  return (
    <SettingsCard className="space-y-2">
      <h2 className="text-sm font-semibold">Auto TP/SL</h2>
      <p className="text-xs text-muted-foreground">After you buy, limit sets a take profit and a stop loss for you, measured from your buy price. A new buy of the same coin replaces them.</p>
      <Segmented value={saved.enabled ? 'on' : 'off'} onChange={(v) => save({ ...saved, enabled: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />

      {saved.enabled && (
        <>
          <p className="pt-1 text-xs font-semibold">For these buys</p>
          <div className="flex gap-1.5">
            <Check on={saved.buys.limit} label="Limit orders" onChange={(v) => save({ ...saved, buys: { ...saved.buys, limit: v } })} />
            <Check on={saved.buys.quick} label="Quick buttons" onChange={(v) => save({ ...saved, buys: { ...saved.buys, quick: v } })} />
            <Check on={saved.buys.manual} label="On fomo" onChange={(v) => save({ ...saved, buys: { ...saved.buys, manual: v } })} />
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs font-semibold text-buy">Take profit</p>
            <Check on={saved.takeProfit.enabled} label={saved.takeProfit.enabled ? 'On' : 'Off'} onChange={(v) => save({ ...saved, takeProfit: { ...saved.takeProfit, enabled: v } })} />
          </div>
          {saved.takeProfit.enabled && (
            <div className="grid grid-cols-2 gap-1.5">
              <FieldBox label="When up" value={draft.tp} onChange={(v) => type('tp', v)} suffix={<span className="text-xs font-semibold">+%</span>} className={box(valid.tp)} />
              <FieldBox label="Sell" value={draft.tpSell} onChange={(v) => type('tpSell', v)} suffix={<span className="text-xs font-semibold">%</span>} className={box(valid.tpSell)} />
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs font-semibold text-sell">Stop loss</p>
            <Check on={saved.stopLoss.enabled} label={saved.stopLoss.enabled ? 'On' : 'Off'} onChange={(v) => save({ ...saved, stopLoss: { ...saved.stopLoss, enabled: v } })} />
          </div>
          {saved.stopLoss.enabled && (
            <>
              <Segmented
                value={saved.stopLoss.trailing ? 'trailing' : 'fixed'}
                onChange={(v) => save({ ...saved, stopLoss: { ...saved.stopLoss, trailing: v === 'trailing' } })}
                options={[{ value: 'fixed', label: 'Fixed' }, { value: 'trailing', label: 'Trailing' }]}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <FieldBox label={saved.stopLoss.trailing ? 'Under the high' : 'When down'} value={draft.sl} onChange={(v) => type('sl', v)} suffix={<span className="text-xs font-semibold">−%</span>} className={box(valid.sl)} />
                <FieldBox label="Sell" value={draft.slSell} onChange={(v) => type('slSell', v)} suffix={<span className="text-xs font-semibold">%</span>} className={box(valid.slSell)} />
              </div>
            </>
          )}
          {!(valid.tp && valid.tpSell && valid.sl && valid.slSell) && (
            <p className="text-[11px] text-destructive">Take profit: +1 to +10,000%. Stop loss: {MIN_TRAIL_PCT} to {MAX_TRAIL_PCT}%. Sell: 1 to 100%.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {saved.takeProfit.enabled && <>At <span className="font-semibold text-buy">+{saved.takeProfit.pct}%</span> sell {saved.takeProfit.sellPct}%. </>}
            {saved.stopLoss.enabled && (saved.stopLoss.trailing
              ? <>If it drops <span className="font-semibold text-sell">{saved.stopLoss.pct}%</span> from its highest point, sell {saved.stopLoss.sellPct}%.</>
              : <>At <span className="font-semibold text-sell">−{saved.stopLoss.pct}%</span> sell {saved.stopLoss.sellPct}%.</>)}
          </p>
        </>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </SettingsCard>
  );
}
