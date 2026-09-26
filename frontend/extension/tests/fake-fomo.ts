/**
 * @file fake-fomo.ts
 * @description A minimal simulation of FOMO's trade panel (structure/classes captured from the live
 *              site on 2026-09-26) that reacts to tab clicks, amount entry and submit.
 * @author Reborn1987
 */

import type { OrderSide } from '../lib/types';

/** Scriptable outcome of clicking submit. */
export type FakeOutcome = 'success' | 'slippage' | 'error' | 'silent';

export interface FakeFomoOptions {
  cash: number;
  position: number;
  outcome?: FakeOutcome;
  /** When true the submit stays on "Minimum amount $2". */
  blockSubmit?: boolean;
}

const ACTIVE: Record<OrderSide, string> = { buy: 'bg-green-transparent', sell: 'bg-red-transparent' };

/** Mounts the fake panel into `doc.body` and returns a handle for inspection. */
export function mountFakeFomo(doc: Document, opts: FakeFomoOptions) {
  const state = { side: 'buy' as OrderSide, amount: '', submitted: null as null | { side: OrderSide; amount: string } };
  doc.body.innerHTML = `
    <div id="panel" class="border border-bg-tertiary rounded-2xl p-2 flex">
      <button type="button" id="tab-buy" class="flex-1 p-2 rounded-lg">Buy</button>
      <button type="button" id="tab-sell" class="flex-1 p-2 rounded-lg">Sell</button>
      <div><span>$</span><input placeholder="0" value="" /></div>
      <div id="presets"></div>
      <div id="balance"></div>
      <button type="button" id="submit" class="py-2 text-center" disabled></button>
    </div>
    <div id="toasts"></div>`;
  const $ = (id: string): HTMLElement => doc.getElementById(id)!;
  const input = doc.querySelector('input')!;

  /** Re-renders the panel to reflect state (like React would). */
  const render = (): void => {
    for (const s of ['buy', 'sell'] as const) {
      $(`tab-${s}`).className = `flex-1 p-2 rounded-lg ${state.side === s ? ACTIVE[s] : 'bg-bg-secondary'}`;
    }
    const presets = state.side === 'buy' ? ['$25', '$50', '$75', '$100'] : ['10%', '25%', '50%', '100%'];
    $('presets').innerHTML = presets.map((p) => `<button type="button" class="hover-scrim h-8">${p}</button>`).join('');
    $('balance').innerHTML = `<div>$${(state.side === 'buy' ? opts.cash : opts.position).toFixed(2)}</div><button>Max</button>`;
    const submit = $('submit') as HTMLButtonElement;
    const ready = state.amount !== '' && Number(state.amount) >= 2 && !opts.blockSubmit;
    submit.disabled = !ready;
    submit.textContent = state.amount === '' ? `${state.side === 'buy' ? 'Buy' : 'Sell'} woj/acc` : ready ? `${state.side === 'buy' ? 'Buy' : 'Sell'} woj/acc` : 'Minimum amount $2';
    for (const b of $('presets').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const pct = parseInt(b.textContent!, 10);
        if (state.side === 'sell') setAmount((opts.position * pct / 100).toFixed(2));
      });
    }
  };
  const setAmount = (v: string): void => { state.amount = v; input.value = v; render(); };

  $('tab-buy').addEventListener('click', () => { state.side = 'buy'; render(); });
  $('tab-sell').addEventListener('click', () => { state.side = 'sell'; render(); });
  input.addEventListener('input', () => { state.amount = input.value; render(); });
  $('submit').addEventListener('click', () => {
    state.submitted = { side: state.side, amount: state.amount };
    const toast = doc.createElement('div');
    toast.className = 'bg-bg-primary rounded-xl outline outline-1';
    toast.textContent = `${state.side === 'buy' ? 'Buying' : 'Selling'} $${state.amount} woj/acc`;
    $('toasts').appendChild(toast);
    setTimeout(() => {
      const amt = Number(state.amount);
      if (opts.outcome === 'slippage') toast.textContent = 'Swap failed: slippage tolerance exceeded';
      else if (opts.outcome === 'error') toast.textContent = 'Transaction failed';
      else if (opts.outcome !== 'silent') {
        if (state.side === 'buy') opts.cash -= amt; else opts.position -= amt;
        setAmount('');
      }
    }, 5);
  });
  render();
  return { state, opts };
}
