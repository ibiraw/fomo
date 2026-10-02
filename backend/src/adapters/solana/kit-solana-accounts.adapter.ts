/**
 * @file kit-solana-accounts.adapter.ts
 * @description SolanaAccountsPort adapter built on @solana/kit (used with Chainstack HTTP + WSS endpoints).
 * @author Reborn1987
 */

import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getAddressDecoder,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from '@solana/kit';

import { AccountNotFoundError } from '../../core/errors.js';
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

const addressDecoder = getAddressDecoder();

/**
 * Most bytes a holder list may take (≈150K holders at ~320 bytes of JSON each). A coin with far more holders once
 * answered with a response that ran the server out of memory on every reconnect (2026-10-02): past this the download
 * stops and the coin is reported as too big to count.
 */
const MAX_HOLDERS_BYTES = 48 * 1024 * 1024;
/** How long a coin that was too big to count isn't downloaded again. */
const TOO_MANY_HOLDERS_MS = 10 * 60_000;

/** The coin has more holders than the server will download. */
export class TooManyHoldersError extends Error {
  constructor() {
    super('Too many holders to count');
    this.name = 'TooManyHoldersError';
  }
}

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
    private readonly httpUrl: string,
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
    try {
      const res = await this.rpc.getTokenSupply(address(mint), { commitment: 'processed' }).send();
      return { amount: BigInt(res.value.amount), decimals: res.value.decimals };
    } catch (err) {
      // The RPC answers "Invalid param" when the address is a wallet, a program or doesn't exist — i.e. not a token.
      if (isSolanaError(err, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS)) throw new AccountNotFoundError(`${mint} is not a token`);
      throw err;
    }
  }

  /** Sums the owner's token accounts for `mint` (the mint filter covers both token programs). */
  async getTokenBalance(owner: string, mint: string): Promise<bigint> {
    const res = await this.rpc
      .getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: 'base64', commitment: 'processed' })
      .send();
    return res.value.reduce((sum, a) => sum + decodeTokenAccountAmount(fromBase64(a.account.data)), 0n);
  }

  /** Coins found too big to count, until when (mint → ms). */
  private readonly tooManyHolders = new Map<string, number>();

  /** Program accounts matching a size and one address field (addresses only, no data transferred). */
  async findProgramAccounts(program: string, dataSize: number, match: { readonly offset: number; readonly bytes: string }): Promise<string[]> {
    const res = await this.rpc
      .getProgramAccounts(address(program), {
        encoding: 'base64',
        commitment: 'confirmed',
        dataSlice: { offset: 0, length: 0 },
        filters: [{ dataSize: BigInt(dataSize) }, { memcmp: { offset: BigInt(match.offset), bytes: match.bytes as never, encoding: 'base58' } }],
      })
      .send();
    return (res as readonly { pubkey: string }[]).map((a) => String(a.pubkey));
  }

  /**
   * All token accounts of the mint, read from the token program that owns the mint (classic or Token-2022), fetching
   * only owner + amount (bytes 32..72) of each. getTokenLargestAccounts would be lighter but the provider refuses it.
   */
  async getTokenHolders(mint: string): Promise<readonly { readonly owner: string; readonly amount: bigint }[]> {
    const info = await this.rpc.getAccountInfo(address(mint), { encoding: 'base64', commitment: 'confirmed' }).send();
    if (!info.value) throw new AccountNotFoundError(`${mint} is not a token`);
    const until = this.tooManyHolders.get(mint);
    if (until && until > Date.now()) throw new TooManyHoldersError();
    // A raw request, read as a stream with a byte cap: the client library would buffer the whole answer first.
    const res = await fetch(this.httpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
        params: [info.value.owner, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok || !res.body) throw new Error(`Holder list request failed (HTTP ${res.status})`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HOLDERS_BYTES) {
        await reader.cancel();
        this.tooManyHolders.set(mint, Date.now() + TOO_MANY_HOLDERS_MS);
        throw new TooManyHoldersError();
      }
      chunks.push(value);
    }
    const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: unknown; error?: { message?: string } };
    if (json.error || !Array.isArray(json.result)) throw new Error(`Holder list request failed: ${json.error?.message ?? 'no result'}`);
    return (json.result as readonly { account: { data: readonly [string, string] } }[]).map(({ account }) => {
      const b = fromBase64(account.data);
      return { owner: addressDecoder.decode(b.subarray(0, 32)), amount: new DataView(b.buffer, b.byteOffset + 32, 8).getBigUint64(0, true) };
    });
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
