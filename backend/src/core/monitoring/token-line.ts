/**
 * @file token-line.ts
 * @description The token line of a monitoring entry — "<network heart> <address>" — and how it is finished before the
 *              entry is recorded: the heart, the ticker and the token's name on one line, and the full address as its
 *              own part below it (tap-to-copy in Telegram; parts are separated by a blank line, which the relay keeps):
 *                💜 $COMPUTE Compute Network
 *                FaoGhqyKofREyNWyu2E1wYqHziLVyq8X2EqcBiWJpump
 *              The heart names the chain, so the entry text alone is enough to look the token up.
 * @author Reborn1987
 */

/** Network heart → chain (the reverse of describe.ts's NETWORK_ICON). */
export const HEART_CHAIN: Readonly<Record<string, string>> = { '💜': 'solana', '💙': 'base', '🩵': 'ethereum', '💛': 'bnb', '💚': 'robinhood', '🩶': 'arc' };

const HEARTS = Object.keys(HEART_CHAIN).join('|');
/** An unfinished token line: exactly "<heart> <address>". */
const LINE_RE = new RegExp(`^(${HEARTS}) (0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$`, 'm');

/** The token key of an entry's (unfinished) token line ("base:0x…" or a Solana mint), or null when it has none. */
export function tokenKeyOfEntry(text: string): string | null {
  const m = LINE_RE.exec(text);
  if (!m) return null;
  const chain = HEART_CHAIN[m[1]!]!;
  return chain === 'solana' ? m[2]! : `${chain}:${m[2]!.toLowerCase()}`;
}

/** A ticker safe to show: letters, digits and a few marks, at most 20 characters; null when nothing is left. */
export function cleanTicker(symbol: string): string | null {
  const s = symbol.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 20);
  return s || null;
}

/**
 * A name safe to show: letters, digits, spaces and a few marks (no "@", "*" or other markup), squeezed, at most
 * 32 characters; null when nothing is left.
 */
export function cleanName(name: string): string | null {
  const s = name.replace(/[^\p{L}\p{N} _.'&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32).trim();
  return s || null;
}

/** What the token line is finished with. */
export interface TokenLabel {
  readonly symbol: string;
  readonly name: string;
}

/**
 * Finishes the entry's token line: "<heart> $TICKER Name" and the full address on the next line. Unchanged when the
 * entry has no unfinished token line or the ticker is unusable (the name alone is dropped when it's unusable or just
 * repeats the ticker).
 */
export function withTokenLabel(text: string, label: TokenLabel | null): string {
  const ticker = label ? cleanTicker(label.symbol) : null;
  if (!ticker) return text;
  const name = cleanName(label!.name);
  const shownName = name && name.toLowerCase() !== ticker.toLowerCase() ? ` ${name}` : '';
  return text.replace(LINE_RE, (_line, heart: string, address: string) => `${heart} $${ticker}${shownName}\n\n${address}`);
}

/**
 * Finishes token lines before entries are recorded. Entries keep their order (one at a time), and a lookup that is
 * slow or fails records the entry as it is after `timeoutMs`.
 */
export class TokenLabeler<K extends string> {
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param labelOf the token's ticker and name (from its metadata) @param record where finished entries go
   * @param timeoutMs longest wait for a lookup
   */
  constructor(
    private readonly labelOf: (key: string) => Promise<TokenLabel | null>,
    private readonly record: (kind: K, text: string) => void,
    private readonly timeoutMs = 3_000,
  ) {}

  /** Queues an entry: recorded with its token's ticker and name when found in time, as is otherwise. */
  push(kind: K, text: string): void {
    this.chain = this.chain.then(async () => {
      const key = tokenKeyOfEntry(text);
      let label: TokenLabel | null = null;
      if (key) {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), this.timeoutMs); });
        label = await Promise.race([this.labelOf(key).catch(() => null), timeout]);
        clearTimeout(timer);
      }
      this.record(kind, withTokenLabel(text, label));
    });
  }

  /** Resolves once everything queued so far is recorded (shutdown, tests). */
  flush(): Promise<void> {
    return this.chain;
  }
}
