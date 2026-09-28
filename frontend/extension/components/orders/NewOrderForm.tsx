/**
 * @file NewOrderForm.tsx
 * @description FOMO-styled limit order form: amount with editable presets ($/%), market cap (or price)
 *              target with a −100%…+100% slider. The order type (limit buy, breakout, take profit, stop loss)
 *              is inferred from whether the target is below or above the current value. Shows what the order would
 *              give at its target (≈ $ for sells, ≈ tokens for buys; before fees and slippage).
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePresets, type AmountUnit } from '@/hooks/use-presets';
import { estimateFill, formatTokenCount } from '@/lib/estimate';
import { formatPrice, formatUsdCompact, orderKind } from '@/lib/format';
import { amountError as amountLimitError } from '@/lib/number-input';
import { inferDirection, percentFromTarget, syncWithLive, targetFromPercent, formatTargetInput, type TargetAnchor } from '@/lib/target';
import { MIN_TRADE_USD, type NewOrder, type OrderSide, type PriceTick, type TriggerDirection, type TriggerMetric } from '@/lib/types';
import { cn } from '@/lib/utils';

import { FieldBox } from './FieldBox';
import { PresetRow } from './PresetRow';
import { Segmented } from './Segmented';
import { TargetSlider } from './TargetSlider';

interface Props {
  readonly ticks: Record<string, PriceTick>;
  readonly onCreate: (order: NewOrder) => Promise<unknown>;
  /** Pre-filled token address. */
  readonly initialMint?: string | null;
  /** When true the token is fixed (on-page panel) and the address field is hidden. */
  readonly lockMint?: boolean;
  /** fomo's displayed supply: market cap is computed with it so it matches the fomo page exactly. */
  readonly mcSupply?: number | null;
  /** Whether the wallet holds the token (null = unknown). Selling is disabled when false. */
  readonly holds?: boolean | null;
  /** Tokens held, from fomo's positions list (null = unknown, e.g. in the popup): needed to estimate % sells. */
  readonly heldTokens?: number | null;
}

/** Order entry form. */
export function NewOrderForm({ ticks, onCreate, initialMint, lockMint = false, mcSupply = null, holds = null, heldTokens = null }: Props) {
  const [mint, setMint] = useState(initialMint ?? '');
  const [side, setSide] = useState<OrderSide>('buy');
  const [unit, setUnit] = useState<AmountUnit>('usd');
  const [amount, setAmount] = useState('');
  const [metric, setMetric] = useState<TriggerMetric>('marketCap');
  const [target, setTarget] = useState('');
  const [percent, setPercent] = useState(0);
  const [manualDirection, setManualDirection] = useState<TriggerDirection>('below');
  /** Pinned value: a % offset (target follows the live value) or an exact typed target (% follows). */
  const [anchor, setAnchor] = useState<TargetAnchor>('percent');
  const { presets, save: savePresets } = usePresets(side, unit);

  useEffect(() => { if (initialMint) setMint(initialMint); }, [initialMint]);
  // Buys default to $ amounts, sells to % of the position (like FOMO's own panel).
  useEffect(() => { setUnit(side === 'buy' ? 'usd' : 'percent'); setAmount(''); }, [side]);

  // A different token needs a fresh target.
  useEffect(() => { setTarget(''); setPercent(0); setAnchor('percent'); }, [mint]);

  const tick = ticks[mint.trim()];
  const current = tick
    ? metric === 'marketCap' ? (mcSupply ? tick.priceUsd * mcSupply : tick.marketCapUsd) : tick.priceUsd
    : null;

  // Follow the live value: keep the pinned % (target moves) or the pinned target (% moves).
  useEffect(() => {
    if (current === null) return;
    const next = syncWithLive(anchor, metric, current, percent, target);
    if (next.target !== target) setTarget(next.target);
    if (next.percent !== percent) setPercent(next.percent);
  }, [current, metric, anchor, percent, target]);

  const onTargetChange = (v: string): void => {
    setTarget(v);
    setAnchor('target');
    if (current !== null && Number(v) > 0) setPercent(percentFromTarget(current, Number(v)));
  };
  const onPercentChange = (p: number): void => {
    setPercent(p);
    setAnchor('percent');
    if (current !== null) setTarget(formatTargetInput(metric, targetFromPercent(current, p)));
  };
  const switchMetric = (): void => { setMetric((m) => (m === 'marketCap' ? 'price' : 'marketCap')); setTarget(''); setPercent(0); setAnchor('percent'); };

  const targetValue = Number(target);
  const direction: TriggerDirection = current !== null && targetValue > 0 ? inferDirection(current, targetValue) : manualDirection;
  const amountValue = Number(amount);
  const amountError = amountLimitError(unit, amount, MIN_TRADE_USD);
  const nothingToSell = side === 'sell' && holds === false;
  const valid = mint.trim().length >= 32 && targetValue > 0 && amountValue > 0 && !amountError && !nothingToSell;

  const create = useMutation({
    mutationFn: () => onCreate({
      mint: mint.trim(),
      side,
      trigger: { metric, direction, value: targetValue, supply: metric === 'marketCap' ? mcSupply : null },
      amount: { kind: unit, value: amountValue },
    }),
    onSuccess: () => setAmount(''),
  });

  const kind = orderKind({ side, trigger: { metric, direction, value: 0 } });
  const estimate = estimateFill({
    side, unit, amount: amountValue, metric, target: targetValue, heldTokens,
    supply: mcSupply ?? (tick && tick.priceUsd > 0 ? tick.marketCapUsd / tick.priceUsd : null),
  });
  const targetLabel = metric === 'marketCap' ? formatUsdCompact(targetValue) : formatPrice(targetValue);

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {!lockMint && (
        <div className="space-y-1.5">
          <Label htmlFor="mint">Token address</Label>
          <Input id="mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Open a token on FOMO or paste its address" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cn(
              'h-9 rounded-lg text-sm font-bold transition-colors',
              side === s ? (s === 'buy' ? 'bg-buy/20 text-buy' : 'bg-sell/20 text-sell') : 'bg-secondary text-muted-foreground hover:bg-accent',
            )}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <FieldBox
          label="Amount"
          value={amount}
          onChange={setAmount}
          placeholder="0.0"
          suffix={<span className="text-sm font-semibold text-foreground">{unit === 'usd' ? '$' : '%'}</span>}
        />
        <PresetRow
          presets={presets}
          unit={unit}
          selected={amount === '' ? null : amountValue}
          onPick={(v) => setAmount(String(v))}
          onUnitToggle={() => { setUnit((u) => (u === 'usd' ? 'percent' : 'usd')); setAmount(''); }}
          onSave={savePresets}
        />
        {amountError && <p className="text-xs text-destructive">{amountError}</p>}
        {unit === 'percent' && <p className="text-[11px] text-muted-foreground">% of your {side === 'buy' ? 'cash' : 'position'} when the order fires</p>}
      </div>

      <div className="space-y-2">
        <FieldBox
          label={<button type="button" onClick={switchMetric} title="Switch between market cap and price" className="rounded border border-input px-1.5 py-0.5 uppercase transition-colors hover:border-foreground/40 hover:text-foreground">{metric === 'marketCap' ? 'Mkt cap' : 'Price'} ⇄</button>}
          value={target}
          onChange={onTargetChange}
          placeholder={current === null ? 'Loading…' : '0'}
          suffix={<span className="text-sm font-semibold text-foreground">$</span>}
        />
        {current !== null ? (
          <TargetSlider percent={percent} onChange={onPercentChange} />
        ) : (
          <Segmented value={manualDirection} onChange={setManualDirection} options={[{ value: 'below', label: '≤ at or below' }, { value: 'above', label: '≥ at or above' }]} />
        )}
        <p className="text-xs text-muted-foreground">
          {current !== null && <>Now {metric === 'marketCap' ? formatUsdCompact(current) : formatPrice(current)} · </>}
          {(tick?.source === 'jupiter' || tick?.source === 'dexscreener') && (
            <span title="This token's pool isn't read on-chain yet; its price comes from Jupiter or DexScreener and can lag a few seconds." className="mr-1 rounded bg-yellow/15 px-1 py-0.5 text-[10px] font-semibold text-yellow">
              slower price
            </span>
          )}
          <span className={cn('font-semibold', side === 'buy' ? 'text-buy' : 'text-sell')}>{kind}</span>
          {targetValue > 0 && <> at {targetLabel}{current !== null && ` (${percent > 0 ? '+' : ''}${percent}%)`}</>}
        </p>
      </div>

      {estimate && (
        <p className="rounded-lg bg-secondary px-2.5 py-2 text-xs text-muted-foreground">
          If it hits, you&apos;d get{' '}
          <span className={cn('font-semibold tabular-nums', side === 'buy' ? 'text-buy' : 'text-sell')}>
            ≈ {estimate.kind === 'usd' ? formatUsdCompact(estimate.value) : `${formatTokenCount(estimate.value)} tokens`}
          </span>{' '}
          <span className="text-[11px]">before fees and slippage</span>
        </p>
      )}
      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      {create.isSuccess && <p className="text-sm text-buy">Order placed.</p>}
      <Button type="submit" className="h-10 w-full rounded-xl font-bold" disabled={!valid || create.isPending}>
        {nothingToSell ? "Nothing to sell — you don't hold this token" : create.isPending ? 'Placing…' : `Place ${kind.toLowerCase()}`}
      </Button>
    </form>
  );
}
