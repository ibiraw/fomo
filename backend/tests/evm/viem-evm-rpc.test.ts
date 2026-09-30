/**
 * @file viem-evm-rpc.test.ts
 * @description Log subscriptions over viem's WebSocket transport re-subscribe once per failure. viem reports a failed
 *              eth_subscribe twice (onError and the rejected promise); reacting to both doubled the subscriptions on
 *              every retry and a long BNB outage ran the server out of memory (2026-09-30).
 * @author Reborn1987
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the fake transport does with each eth_subscribe call. */
type SubscribeArgs = { params: unknown[]; onData: (d: { result?: unknown }) => void; onError: (e: unknown) => void };
const calls: SubscribeArgs[] = [];
let behaviour: 'fail' | 'ok' = 'fail';
const unsubscribed = vi.fn();

vi.mock('viem', () => ({
  http: () => ({}),
  webSocket: () => ({}),
  createPublicClient: () => ({
    transport: {
      /** Mirrors viem 2.x: a failed subscribe calls onError AND rejects. */
      subscribe: (args: SubscribeArgs) => {
        calls.push(args);
        if (behaviour === 'fail') {
          const err = new Error('WebSocket request failed.');
          args.onError(err);
          return Promise.reject(err);
        }
        return Promise.resolve({ unsubscribe: () => { unsubscribed(); return Promise.resolve(); } });
      },
    },
  }),
}));

const { ViemEvmRpcAdapter } = await import('../../src/adapters/evm/viem-evm-rpc.adapter.js');

/** Lets pending promise callbacks run. */
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('ViemEvmRpcAdapter.subscribeLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    behaviour = 'fail';
    unsubscribed.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('re-subscribes once per failed attempt, not twice (no doubling during an outage)', async () => {
    const errors: unknown[] = [];
    const rpc = new ViemEvmRpcAdapter('bnb', 'https://x', 'wss://x', (e) => errors.push(e));
    rpc.subscribeLogs({ address: '0x1' }, () => undefined);
    await flush();
    expect(calls).toHaveLength(1);
    // 1 s, 2 s, 4 s, 8 s, 16 s backoff: five retries, one subscription each.
    for (const ms of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      await vi.advanceTimersByTimeAsync(ms);
      await flush();
    }
    expect(calls).toHaveLength(6);
    expect(errors).toHaveLength(6);
  });

  it('keeps retrying at the 30 s cap without growing', async () => {
    const rpc = new ViemEvmRpcAdapter('bnb', 'https://x', 'wss://x', () => undefined);
    rpc.subscribeLogs({ address: '0x1' }, () => undefined);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // 1+2+4+8+16 = 31 s, then every 30 s: ~20 more in 10 min. Doubling would be astronomically more.
    expect(calls.length).toBeGreaterThan(15);
    expect(calls.length).toBeLessThan(30);
  });

  it('stop() during an outage ends the retries', async () => {
    const rpc = new ViemEvmRpcAdapter('bnb', 'https://x', 'wss://x', () => undefined);
    const sub = rpc.subscribeLogs({ address: '0x1' }, () => undefined);
    await flush();
    sub.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(1);
  });

  it('recovers after the outage and delivers logs; a later socket drop re-subscribes once', async () => {
    const got: unknown[] = [];
    const rpc = new ViemEvmRpcAdapter('bnb', 'https://x', 'wss://x', () => undefined);
    rpc.subscribeLogs({ address: '0x1' }, (log) => got.push(log));
    await flush();
    behaviour = 'ok';
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.onData({ result: { address: '0xAB', topics: [], data: '0x', blockNumber: '0x10', logIndex: '0x1' } });
    expect(got).toHaveLength(1);
    // Socket drop on an established subscription: one retry.
    calls[1]!.onError(new Error('socket closed'));
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(calls).toHaveLength(3);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });
});
