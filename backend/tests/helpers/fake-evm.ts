/**
 * @file fake-evm.ts
 * @description In-memory EvmRpcPort for tests: eth_call answered by ABI-encoded fixtures, logs emitted by hand.
 * @author Reborn1987
 */

import { encodeFunctionResult, toFunctionSelector, type Abi } from 'viem';

import type { EvmChain } from '../../src/core/chains/token-key.js';
import { EvmRpcPort, type EvmLog, type Hex, type LogFilter, type LogSubscription } from '../../src/ports/evm-rpc.js';

type Answer = Hex | Error | ((data: Hex) => Hex);

/** ABI words (uint / address / bool) as call return data or log data. */
export function words(...values: (bigint | number | string | boolean)[]): Hex {
  return `0x${values.map((v) => (typeof v === 'string' ? v.slice(2).toLowerCase() : BigInt(v).toString(16)).padStart(64, '0')).join('')}` as Hex;
}

export class FakeEvmRpc extends EvmRpcPort {
  /** `${to}:${selector}` → answer. */
  private readonly answers = new Map<string, Answer>();
  readonly subs: { filter: LogFilter; listener: (l: EvmLog) => void; stopped: boolean }[] = [];
  calls = 0;
  closed = false;
  head = 100n;
  /** Logs returned by getLogs (filtered by address and block range). */
  history: EvmLog[] = [];
  getLogsCalls: [bigint, bigint][] = [];

  /** @param chain chain slug */
  constructor(readonly chain: EvmChain = 'base') {
    super();
  }

  /** Answers calls of `functionName` on `to` with an ABI-encoded `value` (or an error / a function of calldata). */
  on(to: string, abi: Abi, functionName: string, value: unknown): this {
    const item = abi.find((i) => i.type === 'function' && i.name === functionName)!;
    const selector = toFunctionSelector(item as never);
    const answer: Answer = value instanceof Error || typeof value === 'function'
      ? (value as Answer)
      : encodeFunctionResult({ abi, functionName, result: value } as never);
    this.answers.set(`${to.toLowerCase()}:${selector}`, answer);
    return this;
  }

  /** Answers calls with `selector` on `to` with raw return data (or an error / a function of calldata). */
  raw(to: string, selector: string, answer: Answer): this {
    this.answers.set(`${to.toLowerCase()}:${selector}`, answer);
    return this;
  }

  /** Looks up the fixture for this call. */
  async call(to: Hex, data: Hex): Promise<Hex> {
    this.calls++;
    const a = this.answers.get(`${to.toLowerCase()}:${data.slice(0, 10)}`);
    if (a === undefined) throw new Error(`no fixture for ${to} ${data.slice(0, 10)}`);
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(data) : a;
  }

  /** Current head block. */
  async blockNumber(): Promise<bigint> {
    return this.head;
  }

  /** Returns history logs matching the address list and range. */
  async getLogs(filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<EvmLog[]> {
    this.getLogsCalls.push([fromBlock, toBlock]);
    const addrs = ((Array.isArray(filter.address) ? filter.address : [filter.address]) as string[]).map((a) => a.toLowerCase());
    return this.history.filter((l) => addrs.includes(l.address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  }

  /** Records the subscription. */
  subscribeLogs(filter: LogFilter, listener: (log: EvmLog) => void): LogSubscription {
    const sub = { filter, listener, stopped: false };
    this.subs.push(sub);
    return { stop: () => { sub.stopped = true; } };
  }

  /** Live (not stopped) subscriptions. */
  live(): number {
    return this.subs.filter((s) => !s.stopped).length;
  }

  /** Delivers a log to every live subscription whose address matches. */
  emit(log: { address: string; topics: readonly Hex[]; data: Hex; blockNumber?: bigint; logIndex?: number; transactionHash?: Hex }): void {
    const full: EvmLog = { blockNumber: log.blockNumber ?? 1n, logIndex: log.logIndex ?? 0, topics: log.topics, data: log.data, address: log.address.toLowerCase() as Hex, transactionHash: log.transactionHash ?? '0x' };
    for (const s of this.subs) {
      if (s.stopped) continue;
      const addrs = (Array.isArray(s.filter.address) ? s.filter.address : [s.filter.address]) as string[];
      if (addrs.map((a) => a.toLowerCase()).includes(full.address)) s.listener(full);
    }
  }

  /** Marks closed. */
  async close(): Promise<void> {
    this.closed = true;
  }
}
