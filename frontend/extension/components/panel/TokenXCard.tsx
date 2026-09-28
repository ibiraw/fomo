/**
 * @file TokenXCard.tsx
 * @description Shows the token's X account and when it last posted, with an optional post preview.
 *              Used in the on-page Limit view and the popup.
 * @author Reborn1987
 */

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { RefreshButton } from '@/components/RefreshButton';
import type { SendFn } from '@/hooks/use-background';
import { ageColor, timeAgo } from '@/lib/format';
import type { TokenInfo } from '@/lib/messages';
import type { XLatest } from '@/lib/x-latest';

/** Re-renders every 30s so "12m ago" stays current. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Who the X link points to, in words. */
function sourceLabel(t: NonNullable<TokenInfo['twitter']>): string {
  if (t.kind === 'community') return 'X community';
  return `@${t.handle}`;
}

/** X activity card for one token. */
export function TokenXCard({ mint, send }: { mint: string; send: SendFn }) {
  const now = useNow();
  const [showPost, setShowPost] = useState(false);

  const info = useQuery({
    queryKey: ['token.info', mint],
    queryFn: () => send({ type: 'token.info', mint }) as Promise<TokenInfo>,
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const twitter = info.data?.twitter ?? null;
  const latest = useQuery({
    queryKey: ['x.latest', twitter?.url],
    queryFn: () => send({ type: 'x.latest', url: twitter!.url }) as Promise<XLatest>,
    enabled: !!twitter,
    staleTime: 3 * 60_000,
    retry: false,
  });
  const refresh = (): void => {
    if (twitter) void send({ type: 'x.latest', url: twitter.url, force: true }).then(() => latest.refetch());
  };

  if (info.isPending) return <p className="text-xs text-muted-foreground">Looking up token socials…</p>;
  if (info.isError) return <p className="text-xs text-muted-foreground">Socials unavailable: {info.error.message}</p>;
  if (!twitter) return <p className="text-xs text-muted-foreground">No X account listed for this token.</p>;

  const result = latest.data?.result;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <a href={twitter.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">
          𝕏 {sourceLabel(twitter)}
          <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
        </a>
        <RefreshButton onClick={refresh} busy={latest.isFetching} label="Check the latest post again" />
      </div>

      {latest.isPending && latest.isFetching && <p className="text-xs text-muted-foreground">Checking latest post…</p>}
      {latest.isError && <p className="text-xs text-sell">Could not read X: {latest.error.message}</p>}
      {result && !result.ok && <p className="text-xs text-muted-foreground">{result.message}</p>}
      {result?.ok && (
        <>
          <p className="text-sm">
            Last post <span className="font-semibold" style={{ color: ageColor(result.post.time, now) }}>{timeAgo(result.post.time, now)}</span>
          </p>
          <button
            type="button"
            onClick={() => setShowPost((v) => !v)}
            aria-expanded={showPost}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-accent py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-foreground/40 hover:bg-foreground/10"
          >
            {showPost ? 'Hide post' : 'Show post'}
            {showPost ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          </button>
          {showPost && (
            <a href={result.post.url} target="_blank" rel="noreferrer" className="block space-y-2 rounded-md border border-input bg-secondary p-2 transition-colors hover:border-foreground/40">
              <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>@{result.post.author} · {new Date(result.post.time).toLocaleString()}</span>
                <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2">Open on X <ExternalLink className="size-3" aria-hidden /></span>
              </p>
              {result.post.text && <p className="whitespace-pre-wrap text-xs leading-relaxed">{result.post.text}</p>}
              {result.post.image && <img src={result.post.image} alt="" className="max-h-40 w-full rounded object-cover" />}
            </a>
          )}
        </>
      )}
    </div>
  );
}
