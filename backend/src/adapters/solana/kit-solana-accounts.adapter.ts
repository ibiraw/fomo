/**
 * @file kit-solana-accounts.adapter.ts
 * @description SolanaAccountsPort adapter built on @solana/kit (used with Chainstack HTTP + WSS endpoints).
 * @author Reborn1987
 */

import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from '@solana/kit';

import { decodeTokenAccountAmount } from '../../core/pricing/decoders.js';
import type { ConnectionHealth } from '../../ports/connection-health.js';
import {
  SolanaAccountsPort,
  type AccountListener,
  type AccountSubscription,
  type MintSupply,
} from '../../ports/solana-accounts.js';

/** Reconnect backoff bounds (ms). */
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

/** Decodes a base64 account payload returned by the RPC. */
function fromBase64(data: readonly [string, string]): Uint8Array {
  return new Uint8Array(Buffer.from(data[0], 'base64'));
}

/** Resolves after `ms` milliseconds unless aborted first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** Minimum gap between "empty account data" warnings for one address. */
const EMPTY_WARN_INTERVAL_MS = 5 * 60_000;

export class KitSolanaAccountsAdapter extends SolanaAccountsPort {
  private readonly lastEmptyWarn = new Map<string, number>();
  private readonly rpc: Rpc<SolanaRpcApi>;
  private readonly subs: RpcSubscriptions<SolanaRpcSubscriptionsApi>;

  /**
   * @param httpUrl RPC HTTPS endpoint. @param wssUrl RPC WebSocket endpoint. @param onError error sink for logging.
   * @param health drop/recovery reports (monitoring alerts only on lasting outages)
   * @param onWarn sink for self-healing data glitches (empty updates); defaults to onError
   */
  constructor(
    httpUrl: string,
    wssUrl: string,
    private readonly onError: (err: unknown) => void,
    private readonly health: ConnectionHealth | null = null,
    private readonly onWarn: (err: unknown) => void = onError,
  ) {
    super();
    this.rpc = createSolanaRpc(httpUrl);
    this.subs = createSolanaRpcSubscriptions(wssUrl);
  }

  /** Fetches raw account bytes at 'processed' commitment. */
  async getAccount(addr: string): Promise<Uint8Array | null> {
    const res = await this.rpc
      .getAccountInfo(address(addr), { encoding: 'base64', commitment: 'processed' })
      .send();
    return res.value ? fromBase64(res.value.data) : null;
  }

  /** Reports an empty-data notification at most once per address per 5 minutes. */
  private warnEmpty(addr: string): void {
    const now = Date.now();
    if (now - (this.lastEmptyWarn.get(addr) ?? 0) < EMPTY_WARN_INTERVAL_MS) return;
    this.lastEmptyWarn.set(addr, now);
    this.onWarn(new Error(`Skipped an empty account update for ${addr} (RPC glitch; waiting for the next update)`));
  }

  /** Fetches mint supply and decimals. */
  async getMintSupply(mint: string): Promise<MintSupply> {
    const res = await this.rpc.getTokenSupply(address(mint), { commitment: 'processed' }).send();
    return { amount: BigInt(res.value.amount), decimals: res.value.decimals };
  }

  /** Sums the owner's token accounts for `mint` (the mint filter covers both token programs). */
  async getTokenBalance(owner: string, mint: string): Promise<bigint> {
    const res = await this.rpc
      .getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: 'base64', commitment: 'processed' })
      .send();
    return res.value.reduce((sum, a) => sum + decodeTokenAccountAmount(fromBase64(a.account.data)), 0n);
  }

  /**
   * Subscribes with automatic reconnect. After each (re)connect the current state is fetched
   * and delivered, so updates missed while disconnected are recovered.
   */
  subscribe(addr: string, listener: AccountListener): AccountSubscription {
    const abort = new AbortController();
    const run = async (): Promise<void> => {
      let backoff = MIN_BACKOFF_MS;
      while (!abort.signal.aborted) {
        try {
          const stream = await this.subs
            .accountNotifications(address(addr), { encoding: 'base64', commitment: 'processed' })
            .subscribe({ abortSignal: abort.signal });
          const current = await this.rpc
            .getAccountInfo(address(addr), { encoding: 'base64', commitment: 'processed' })
            .send();
          if (current.value) listener(fromBase64(current.value.data), current.context.slot);
          backoff = MIN_BACKOFF_MS;
          this.health?.up();
          for await (const note of stream) {
            const data = fromBase64(note.value.data);
            if (data.length === 0) {
              // Seen transiently from the RPC at 'processed' commitment; the next update carries real data.
              this.warnEmpty(addr);
              continue;
            }
            listener(data, note.context.slot);
          }
        } catch (err) {
          if (abort.signal.aborted) return;
          this.onError(err);
          this.health?.down(err);
        }
        await sleep(backoff, abort.signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    };
    void run();
    return { stop: () => abort.abort() };
  }
}
