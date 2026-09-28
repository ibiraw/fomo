/**
 * @file token-line.ts
 * @description The token line of a monitoring entry — "<network heart> <address>" — and what's added around it:
 *              the token's ticker ("💜 FaoGhq…WJpump - $COMPUTE") before the entry is recorded, and in Telegram a short
 *              address that links to the token on fomo. The heart names the chain, so the entry text alone is enough.
 * @author Reborn1987
 */

/** Network heart → chain (the reverse of describe.ts's NETWORK_ICON). */
export const HEART_CHAIN: Readonly<Record<string, string>> = { '💜': 'solana', '💙': 'base', '🩵': 'ethereum', '💛': 'bnb', '💚': 'robinhood', '🩶': 'arc' };

const HEARTS = Object.keys(HEART_CHAIN).join('|');
/** A whole line "<heart> <address>" (optionally already followed by " - $TICKER"). */
const LINE_RE = new RegExp(`^(${HEARTS}) (0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})( - \\$\\S+)?$`, 'm');

/** The token key of an entry's token line ("base:0x…" or a Solana mint), or null when it has none. */
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

/** Appends " - $TICKER" to the entry's token line (unchanged when it has none or already has a ticker). */
export function withTicker(text: string, symbol: string | null): string {
  const ticker = symbol ? cleanTicker(symbol) : null;
  if (!ticker) return text;
  return text.replace(LINE_RE, (line, _h, _a, existing) => (existing ? line : `${line} - $${ticker}`));
}

/**
 * Adds tickers to entries before they are recorded. Entries keep their order (one at a time), and a lookup that is
 * slow or fails records the entry without a ticker after `timeoutMs`.
 */
export class TickerEnricher<K extends string> {
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param symbolOf the token's ticker (from its metadata) @param record where finished entries go
   * @param timeoutMs longest wait for a ticker
   */
  constructor(
    private readonly symbolOf: (key: string) => Promise<string | null>,
    private readonly record: (kind: K, text: string) => void,
    private readonly timeoutMs = 3_000,
  ) {}

  /** Queues an entry: recorded with its ticker when found in time, as is otherwise. */
  push(kind: K, text: string): void {
    this.chain = this.chain.then(async () => {
      const key = tokenKeyOfEntry(text);
      let symbol: string | null = null;
      if (key) {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), this.timeoutMs); });
        symbol = await Promise.race([this.symbolOf(key).catch(() => null), timeout]);
        clearTimeout(timer);
      }
      this.record(kind, withTicker(text, symbol));
    });
  }

  /** Resolves once everything queued so far is recorded (shutdown, tests). */
  flush(): Promise<void> {
    return this.chain;
  }
}
