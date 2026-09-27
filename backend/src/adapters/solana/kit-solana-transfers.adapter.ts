/**
 * @file kit-solana-transfers.adapter.ts
 * @description SolanaTransfersPort over @solana/kit: signatures of the wallet's token accounts for a mint, then the
 *              transactions' token balance changes (received = treasury's post − pre; sender = the other owner whose
 *              balance of that mint went down the most).
 * @author Reborn1987
 */

import { address, createSolanaRpc, signature as toSignature } from '@solana/kit';

import { SolanaTransfersPort, type SolanaIncoming, type SolanaTransfer } from '../../ports/solana-transfers.js';

/** Token balance entry of a parsed transaction. */
interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/** Signatures read per request per token account. */
const PAGE = 50;
/** Pages read back per token account in one poll (a first scan from slot 0 stops here). */
const MAX_PAGES = 20;

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

  /** Slot of the newest signature over the wallet's token accounts for the mint. */
  async latestSlot(owner: string, mint: string): Promise<bigint | null> {
    let best: bigint | null = null;
    for (const ata of await this.tokenAccounts(owner, mint)) {
      const [first] = await this.rpc.getSignaturesForAddress(address(ata), { limit: 1, commitment: 'confirmed' }).send();
      if (first && (best === null || first.slot > best)) best = first.slot;
    }
    return best;
  }

  /** Incoming transfers in slots after `afterSlot`, oldest first (pages back from the newest, never by an old signature). */
  async incoming(owner: string, mint: string, afterSlot: bigint): Promise<SolanaIncoming> {
    const fresh: { signature: string; slot: bigint }[] = [];
    let newestSlot: bigint | null = null;
    for (const ata of await this.tokenAccounts(owner, mint)) {
      let before: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const sigs = await this.rpc
          .getSignaturesForAddress(address(ata), { limit: PAGE, commitment: 'confirmed', ...(before ? { before: toSignature(before) } : {}) })
          .send();
        for (const s of sigs) {
          if (s.slot <= afterSlot) continue;
          if (newestSlot === null || s.slot > newestSlot) newestSlot = s.slot;
          if (!s.err) fresh.push({ signature: s.signature, slot: s.slot });
        }
        const oldest = sigs.at(-1);
        if (sigs.length < PAGE || !oldest || oldest.slot <= afterSlot) break;
        before = oldest.signature;
      }
    }
    fresh.sort((x, y) => (x.slot < y.slot ? -1 : x.slot > y.slot ? 1 : 0));
    const out: SolanaTransfer[] = [];
    for (const s of fresh) {
      const tx = await this.rpc.getTransaction(toSignature(s.signature), { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).send();
      const meta = tx?.meta as { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null | undefined;
      const t = meta ? transferFrom(meta.preTokenBalances ?? [], meta.postTokenBalances ?? [], owner, mint) : null;
      if (t) out.push({ signature: s.signature, slot: s.slot, ...t });
    }
    return { transfers: out, newestSlot };
  }

  /** The wallet's token account addresses for a mint. */
  private async tokenAccounts(owner: string, mint: string): Promise<string[]> {
    const res = await this.rpc.getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: 'base64', commitment: 'confirmed' }).send();
    return res.value.map((a) => a.pubkey);
  }
}
