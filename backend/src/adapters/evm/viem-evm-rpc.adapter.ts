/**
 * @file viem-evm-rpc.adapter.ts
 * @description EvmRpcPort over viem: batched HTTP for eth_call, WebSocket eth_subscribe("logs") for live logs.
 *              Subscriptions re-subscribe with backoff when the socket errors.
 * @author Reborn1987
 */

import { createPublicClient, http, webSocket, type PublicClient } from 'viem';

import type { EvmChain } from '../../core/chains/token-key.js';
import { EvmRpcPort, type EvmLog, type Hex, type LogFilter, type LogSubscription } from '../../ports/evm-rpc.js';

/** Raw log object as sent by the node in a `logs` subscription. */
interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  removed?: boolean;
}

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** Viem-backed EVM chain access. */
export class ViemEvmRpcAdapter extends EvmRpcPort {
  private readonly httpClient: PublicClient;
  private readonly wsClient: PublicClient;
  private closed = false;

  /**
   * @param chain chain slug @param httpUrl JSON-RPC HTTPS endpoint @param wssUrl JSON-RPC WebSocket endpoint
   * @param onError sink for transient socket/subscription errors
   */
  constructor(
    readonly chain: EvmChain,
    httpUrl: string,
    wssUrl: string,
    private readonly onError: (err: unknown) => void,
  ) {
    super();
    this.httpClient = createPublicClient({ transport: http(httpUrl, { batch: { wait: 5 }, retryCount: 2 }) });
    this.wsClient = createPublicClient({ transport: webSocket(wssUrl, { keepAlive: { interval: 20_000 }, reconnect: { attempts: 1_000, delay: 2_000 } }) });
  }

  /** eth_call at the latest block. */
  async call(to: Hex, data: Hex): Promise<Hex> {
    const res = await this.httpClient.call({ to, data });
    return res.data ?? '0x';
  }

  /** Subscribes to logs; on socket errors it re-subscribes with exponential backoff until stop(). */
  subscribeLogs(filter: LogFilter, listener: (log: EvmLog) => void): LogSubscription {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    let retryMs = RETRY_MIN_MS;
    let retryTimer: NodeJS.Timeout | null = null;

    const resubscribeLater = (err: unknown): void => {
      if (stopped || this.closed) return;
      this.onError(err);
      unsubscribe?.();
      unsubscribe = null;
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };

    const open = (): void => {
      if (stopped) return;
      const params = { address: filter.address, ...(filter.topics ? { topics: filter.topics } : {}) };
      // viem's socket transport exposes the raw eth_subscribe API used by its own watch* actions.
      const transport = this.wsClient.transport as unknown as {
        subscribe(args: { params: unknown[]; onData: (data: { result?: RawLog }) => void; onError: (e: unknown) => void }): Promise<{ unsubscribe: () => Promise<unknown> }>;
      };
      transport
        .subscribe({
          params: ['logs', params],
          onData: (data) => {
            const raw = data.result;
            if (!raw || raw.removed) return;
            retryMs = RETRY_MIN_MS;
            listener({ address: raw.address.toLowerCase() as Hex, topics: raw.topics, data: raw.data, blockNumber: BigInt(raw.blockNumber), logIndex: Number(raw.logIndex) });
          },
          onError: resubscribeLater,
        })
        .then((sub) => {
          if (stopped) void sub.unsubscribe().catch(() => undefined);
          else unsubscribe = () => void sub.unsubscribe().catch(() => undefined);
        })
        .catch(resubscribeLater);
    };

    open();
    return {
      stop: () => {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        unsubscribe?.();
      },
    };
  }

  /** Closes the WebSocket. */
  async close(): Promise<void> {
    this.closed = true;
    const t = this.wsClient.transport as unknown as { getRpcClient?: () => Promise<{ close: () => void }> };
    if (t.getRpcClient) (await t.getRpcClient()).close();
  }
}
