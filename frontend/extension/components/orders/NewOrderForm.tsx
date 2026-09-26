/**
 * @file NewOrderForm.tsx
 * @description Form to create a limit buy / breakout buy / take-profit / stop-loss order.
 *              Used by the popup (editable token) and the on-page panel (token fixed to the page).
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPrice, formatUsdCompact, orderKind } from '@/lib/format';
import { MIN_TRADE_USD, type NewOrder, type OrderSide, type PriceTick, type TriggerDirection, type TriggerMetric } from '@/lib/types';
import { cn } from '@/lib/utils';

import { Segmented } from './Segmented';

interface Props {
  readonly ticks: Record<string, PriceTick>;
  readonly onCreate: (order: NewOrder) => Promise<void>;
  /** Pre-filled token address. */
  readonly initialMint?: string | null;
  /** When true the token is fixed (on-page panel) and the address field is hidden. */
  readonly lockMint?: boolean;
}

/** Order entry form. */
export function NewOrderForm({ ticks, onCreate, initialMint, lockMint = false }: Props) {
  const [mint, setMint] = useState(initialMint ?? '');
  const [side, setSide] = useState<OrderSide>('buy');
  const [metric, setMetric] = useState<TriggerMetric>('marketCap');
  const [direction, setDirection] = useState<TriggerDirection>('below');
  const [target, setTarget] = useState('');
  const [amountKind, setAmountKind] = useState<'usd' | 'percent'>('usd');
  const [amount, setAmount] = useState('');

  useEffect(() => { if (initialMint) setMint(initialMint); }, [initialMint]);
  // Sensible defaults per side: buys wait for dips in $, sells wait for pumps in % of the position.
  useEffect(() => {
    setDirection(side === 'buy' ? 'below' : 'above');
    setAmountKind(side === 'buy' ? 'usd' : 'percent');
  }, [side]);

  const create = useMutation({
    mutationFn: () => onCreate({
      mint: mint.trim(),
      side,
      trigger: { metric, direction, value: Number(target) },
      amount: { kind: amountKind, value: Number(amount) },
    }),
    onSuccess: () => { setTarget(''); setAmount(''); },
  });

  const tick = ticks[mint.trim()];
  const amountError = amountKind === 'usd' && amount !== '' && Number(amount) < MIN_TRADE_USD ? `Minimum $${MIN_TRADE_USD}` : null;
  const valid = mint.trim().length >= 32 && Number(target) > 0 && Number(amount) > 0 && !amountError;

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {!lockMint && (
        <div className="space-y-1.5">
          <Label htmlFor="mint">Token address</Label>
          <Input id="mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Open a token on FOMO or paste its address" />
        </div>
      )}
      {tick && (
        <p className="text-xs text-muted-foreground">
          Now: MC {formatUsdCompact(tick.marketCapUsd)} · Price {formatPrice(tick.priceUsd)}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(['buy', 'sell'] as const).map((s) => (
          <Button
            key={s}
            type="button"
            variant="secondary"
            onClick={() => setSide(s)}
            className={cn(side === s && (s === 'buy' ? 'bg-buy/20 text-buy hover:bg-buy/25' : 'bg-sell/20 text-sell hover:bg-sell/25'))}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>When</Label>
        <div className="grid grid-cols-2 gap-2">
          <Segmented value={metric} onChange={setMetric} options={[{ value: 'marketCap', label: 'Market cap' }, { value: 'price', label: 'Price' }]} />
          <Segmented value={direction} onChange={setDirection} options={[{ value: 'below', label: '≤ below' }, { value: 'above', label: '≥ above' }]} />
        </div>
        <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={metric === 'marketCap' ? 'Market cap in $, e.g. 3000' : 'Price in $, e.g. 0.000004'} />
        <p className="text-xs text-muted-foreground">
          {orderKind({ side, trigger: { metric, direction, value: 0 } })}
          {Number(target) > 0 && ` at ${metric === 'marketCap' ? `MC ${formatUsdCompact(Number(target))}` : formatPrice(Number(target))}`}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Amount</Label>
        <Segmented
          value={amountKind}
          onChange={setAmountKind}
          options={[{ value: 'usd', label: '$ amount' }, { value: 'percent', label: `% of ${side === 'buy' ? 'cash' : 'position'}` }]}
        />
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountKind === 'usd' ? `Dollars (min $${MIN_TRADE_USD})` : 'Percent, e.g. 50'} />
        {amountError && <p className="text-xs text-destructive">{amountError}</p>}
      </div>

      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      {create.isSuccess && <p className="text-sm text-buy">Order placed.</p>}
      <Button type="submit" className="w-full" disabled={!valid || create.isPending}>
        {create.isPending ? 'Placing…' : 'Place order'}
      </Button>
    </form>
  );
}
