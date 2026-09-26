/**
 * @file contract.ts
 * @description One typed-at-the-call-site helper for view calls: ABI-encode, eth_call, ABI-decode.
 * @author Reborn1987
 */

import { decodeFunctionResult, encodeFunctionData, type Abi } from 'viem';

import type { EvmRpcPort, Hex } from '../../ports/evm-rpc.js';

/** Calls `functionName` on `to` and returns the decoded result (callers state the expected type). */
export async function readContract<T>(rpc: EvmRpcPort, to: Hex, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  return decodeFunctionResult({ abi, functionName, data: await rpc.call(to, data) } as never) as T;
}

/** True when an eth_call reverted (the contract exists but rejected or doesn't implement the call). */
export function isRevert(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (/revert/i.test(e.message) || /revert/i.test((e as { details?: string }).details ?? '')) return true;
  }
  return false;
}
