/**
 * @file use-token-symbols.ts
 * @description Token symbols for a set of mints (from the server's token.info, cached), so order rows
 *              can say "$UNPEG" instead of an address.
 * @author Reborn1987
 */

import { useQueries } from '@tanstack/react-query';

import type { TokenInfo } from '@/lib/messages';

import type { SendFn } from './use-background';

/** mint → "$SYMBOL" for every mint whose info has loaded. */
export function useTokenSymbols(mints: readonly string[], send: SendFn, enabled: boolean): Record<string, string> {
  const unique = [...new Set(mints)];
  const results = useQueries({
    queries: unique.map((mint) => ({
      queryKey: ['token.info', mint],
      queryFn: () => send({ type: 'token.info', mint }) as Promise<TokenInfo>,
      staleTime: 30 * 60_000,
      retry: 1,
      enabled,
    })),
  });
  const out: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.data?.symbol) out[unique[i]!] = `$${r.data.symbol}`;
  });
  return out;
}
