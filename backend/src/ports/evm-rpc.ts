/**
 * @file evm-rpc.ts
 * @description EvmRpcPort — read-only JSON-RPC access to one EVM chain: contract calls and live log subscriptions.
 * @author Reborn1987
 */

import type { EvmChain } from '../core/chains/token-key.js';

export type Hex = `0x${string}`;

/** A log as delivered by a subscription. */
export interface EvmLog {
  readonly address: Hex;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  /** Transaction that emitted the log (empty when the node did not say). */
  readonly transactionHash: Hex;
}

/** Log filter: contract address(es) and positional topics (null = any). */
export interface LogFilter {
  readonly address: Hex | readonly Hex[];
  readonly topics?: readonly (Hex | readonly Hex[] | null)[];
}

/** Handle for a live log subscription. */
export interface LogSubscription {
  stop(): void;
}

/** Abstract EVM chain access. Adapter: ViemEvmRpcAdapter. */
export abstract class EvmRpcPort {
  /** Which chain this connection reads. */
  abstract readonly chain: EvmChain;

  /** eth_call against the latest block; returns the raw return data. */
  abstract call(to: Hex, data: Hex): Promise<Hex>;

  /** Latest block number. */
  abstract blockNumber(): Promise<bigint>;

  /** True when the address has contract code (a pool, a launchpad, a token), false for a wallet. */
  abstract isContract(address: Hex): Promise<boolean>;

  /** The contract code at an address ("0x" for a wallet). */
  abstract code(address: Hex): Promise<Hex>;

  /** The wallet that sent a transaction. */
  abstract transactionSender(hash: Hex): Promise<Hex>;

  /** Historical logs in [fromBlock, toBlock] (callers keep ranges within the provider's limit). */
  abstract getLogs(filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<EvmLog[]>;

  /** Streams matching logs as blocks arrive (reconnecting on socket loss). */
  abstract subscribeLogs(filter: LogFilter, listener: (log: EvmLog) => void): LogSubscription;

  /** Closes connections. */
  abstract close(): Promise<void>;
}
