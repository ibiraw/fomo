/**
 * @file NewOrderForm.tsx
 * @description Form to create a limit buy / breakout buy / take-profit / stop-loss order.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatPrice, formatUsdCompact, mintFromFomoUrl, orderKind } from '@/lib/format';
import { MIN_TRADE_USD, type NewOrder, type OrderSide, type PriceTick, type TriggerDirection, type TriggerMetric } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  readonly ticks: Record<string, PriceTick>;
  readonly onCreate: (order: NewOrder) => Promise<void>;
}

/** Order entry form; pre-fills the token from the active FOMO tab. */
export function NewOrderForm({ ticks, onCreate }: Props) {
  const [mint, setMint] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [metric, setMetric] = useState<TriggerMetric>('marketCap');
  const [direction, setDirection] = useState<TriggerDirection>('below');
  const [target, setTarget] = useState('');
  const [amountKind, setAmountKind] = useState<'usd' | 'percent'>('usd');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const m = mintFromFomoUrl(tab?.url);
      if (m) setMint(m);
    });
  }, []);

  // Sensible default direction per side: buys wait for dips, sells for pumps.
  useEffect(() => setDirection(side === 'buy' ? 'below' : 'above'), [side]);
  useEffect(() => setAmountKind(side === 'buy' ? 'usd' : 'percent'), [side]);

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
      <div className="space-y-1.5">
        <Label htmlFor="mint">Token address</Label>
        <Input id="mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Open a token on FOMO or paste its address" />
        {tick && (
          <p className="text-xs text-muted-foreground">
            Now: MC {formatUsdCompact(tick.marketCapUsd)} · Price {formatPrice(tick.priceUsd)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['buy', 'sell'] as const).map((s) => (
          <Button
            key={s}
            type="button"
            variant="secondary"
            onClick={() => setSide(s)}
            className={cn(side === s && (s === 'buy' ? 'bg-buy/20 text-buy' : 'bg-sell/20 text-sell'))}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>When</Label>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as TriggerMetric)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="marketCap">Market cap</SelectItem>
              <SelectItem value="price">Price</SelectItem>
            </SelectContent>
          </Select>
          <Select value={direction} onValueChange={(v) => setDirection(v as TriggerDirection)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="below">≤ at or below</SelectItem>
              <SelectItem value="above">≥ at or above</SelectItem>
            </SelectContent>
          </Select>
          <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={metric === 'marketCap' ? 'e.g. 3000' : 'e.g. 0.000004'} />
        </div>
        <p className="text-xs text-muted-foreground">
          {orderKind({ side, trigger: { metric, direction, value: 0 } })}
          {Number(target) > 0 && ` at ${metric === 'marketCap' ? `MC ${formatUsdCompact(Number(target))}` : formatPrice(Number(target))}`}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Amount</Label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountKind === 'usd' ? 'Dollars' : 'Percent'} />
          <Select value={amountKind} onValueChange={(v) => setAmountKind(v as 'usd' | 'percent')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="usd">$</SelectItem>
              <SelectItem value="percent">% of {side === 'buy' ? 'cash' : 'position'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
