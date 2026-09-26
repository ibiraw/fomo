/**
 * @file kit-solana-transfers.adapter.ts
 * @description SolanaTransfersPort over @solana/kit: signatures of the wallet's token accounts for a mint, then the
 *              transactions' token balance changes (received = treasury's post − pre; sender = the other owner whose
 *              balance of that mint went down the most).
 * @author Reborn1987
 */

import { address, createSolanaRpc, signature as toSignature } from '@solana/kit';

import { SolanaTransfersPort, type SolanaTransfer } from '../../ports/solana-transfers.js';

/** Token balance entry of a parsed transaction. */
interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/** Transactions read per poll per token account. */
const PAGE = 50;

/** Received amount and sender from a transaction's token balances, or null when nothing was received. */
export function transferFrom(pre: TokenBalance[], post: TokenBalance[], owner: string, mint: string): { from: string; amountRaw: bigint } | null {
  const bal = (list: TokenBalance[], idx: number): bigint => BigInt(list.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0');
  const indexes = new Set([...pre, ...post].filter((b) => b.mint === mint).map((b) => b.accountIndex));
  let received = 0n;
  let from = '';
  let biggestDrop = 0n;
  for (const idx of indexes) {
    const entry = post.find((b) => b.accountIndex === idx) ?? pre.find((b) => b.accountIndex === idx);
    const delta = bal(post, idx) - bal(pre, idx);
    if (entry?.owner === owner) received += delta;
    else if (-delta > biggestDrop) {
      biggestDrop = -delta;
      from = entry?.owner ?? '';
    }
  }
  return received > 0n ? { from, amountRaw: received } : null;
}

export class KitSolanaTransfersAdapter extends SolanaTransfersPort {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  /** @param httpUrl Solana JSON-RPC endpoint */
  constructor(httpUrl: string) {
    super();
    this.rpc = createSolanaRpc(httpUrl);
  }

  /** Newest signature over the wallet's token accounts for the mint. */
  async latestSignature(owner: string, mint: string): Promise<string | null> {
    let best: { sig: string; slot: bigint } | null = null;
    for (const ata of await this.tokenAccounts(owner, mint)) {
      const [first] = await this.rpc.getSignaturesForAddress(address(ata), { limit: 1, commitment: 'confirmed' }).send();
      if (first && (!best || first.slot > best.slot)) best = { sig: first.signature, slot: first.slot };
    }
    return best?.sig ?? null;
  }

  /** Incoming transfers newer than `afterSignature`. */
  async incoming(owner: string, mint: string, afterSignature: string | null): Promise<SolanaTransfer[]> {
    const out: SolanaTransfer[] = [];
    for (const ata of await this.tokenAccounts(owner, mint)) {
      const sigs = await this.rpc
        .getSignaturesForAddress(address(ata), { limit: PAGE, commitment: 'confirmed', ...(afterSignature ? { until: toSignature(afterSignature) } : {}) })
        .send();
      for (const s of [...sigs].reverse()) {
        if (s.err) continue;
        const tx = await this.rpc.getTransaction(s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).send();
        const meta = tx?.meta as { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null | undefined;
        const t = meta ? transferFrom(meta.preTokenBalances ?? [], meta.postTokenBalances ?? [], owner, mint) : null;
        if (t) out.push({ signature: s.signature, ...t });
      }
    }
    return out;
  }

  /** The wallet's token account addresses for a mint. */
  private async tokenAccounts(owner: string, mint: string): Promise<string[]> {
    const res = await this.rpc.getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: 'base64', commitment: 'confirmed' }).send();
    return res.value.map((a) => a.pubkey);
  }
}
