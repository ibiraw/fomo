/**
 * @file viem-evm-rpc.adapter.ts
 * @description EvmRpcPort over viem: batched HTTP for eth_call, WebSocket eth_subscribe("logs") for live logs.
 *              Subscriptions re-subscribe with backoff when the socket errors.
 * @author Reborn1987
 */

import { createPublicClient, http, webSocket, type PublicClient } from 'viem';

import type { EvmChain } from '../../core/chains/token-key.js';
import { EvmRpcPort, type EvmLog, type Hex, type LogFilter, type LogSubscription } from '../../ports/evm-rpc.js';
import type { ConnectionHealth } from '../../ports/connection-health.js';

/** Raw log object as sent by the node in a `logs` subscription. */
interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash?: Hex;
  removed?: boolean;
}

/** Converts a node log to EvmLog. */
function toLog(raw: RawLog): EvmLog {
  return {
    address: raw.address.toLowerCase() as Hex,
    topics: raw.topics,
    data: raw.data,
    blockNumber: BigInt(raw.blockNumber),
    logIndex: Number(raw.logIndex),
    transactionHash: (raw.transactionHash ?? '0x') as Hex,
  };
}

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** Viem-backed EVM chain access. */
/** Requests per JSON-RPC batch: the provider rejects larger batches ("Request exceeds defined limit"). */
const BATCH_SIZE = 10;

export class ViemEvmRpcAdapter extends EvmRpcPort {
  private readonly httpClient: PublicClient;
  private readonly wsClient: PublicClient;
  private closed = false;

  /**
   * @param chain chain slug @param httpUrl JSON-RPC HTTPS endpoint @param wssUrl JSON-RPC WebSocket endpoint
   * @param onError sink for transient socket/subscription errors
   * @param health drop/recovery reports (monitoring alerts only on lasting outages)
   */
  constructor(
    readonly chain: EvmChain,
    httpUrl: string,
    wssUrl: string,
    private readonly onError: (err: unknown) => void,
    private readonly health: ConnectionHealth | null = null,
  ) {
    super();
    this.httpClient = createPublicClient({ transport: http(httpUrl, { batch: { wait: 5, batchSize: BATCH_SIZE }, retryCount: 2 }) });
    this.wsClient = createPublicClient({ transport: webSocket(wssUrl, { keepAlive: { interval: 20_000 }, reconnect: { attempts: 1_000, delay: 2_000 } }) });
  }

  /** eth_call at the latest block. */
  async call(to: Hex, data: Hex): Promise<Hex> {
    const res = await this.httpClient.call({ to, data });
    return res.data ?? '0x';
  }

  /** Latest block number. */
  blockNumber(): Promise<bigint> {
    return this.httpClient.getBlockNumber({ cacheTime: 0 });
  }

  /** eth_getCode: anything but empty code is a contract. */
  async isContract(address: Hex): Promise<boolean> {
    const code = await this.httpClient.getCode({ address });
    return !!code && code !== '0x';
  }

  /** eth_getTransactionByHash → from. */
  async transactionSender(hash: Hex): Promise<Hex> {
    return (await this.httpClient.getTransaction({ hash })).from;
  }

  /** eth_getLogs over a block range (removed logs dropped). */
  async getLogs(filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<EvmLog[]> {
    const raw = (await this.httpClient.request({
      method: 'eth_getLogs',
      params: [{ address: filter.address, ...(filter.topics ? { topics: filter.topics } : {}), fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
    } as never)) as RawLog[];
    return raw.filter((l) => !l.removed).map(toLog);
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
      this.health?.down(err);
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
            listener(toLog(raw));
          },
          onError: resubscribeLater,
        })
        .then((sub) => {
          if (stopped) void sub.unsubscribe().catch(() => undefined);
          else {
            unsubscribe = () => void sub.unsubscribe().catch(() => undefined);
            this.health?.up();
          }
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
