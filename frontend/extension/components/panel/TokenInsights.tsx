/**
 * @file TokenInsights.tsx
 * @description Facts about the token on the page, shown in the Limit panel and the popup: where it was launched
 *              (v1.8) and whether it is still on the launchpad's bonding curve. Renders nothing for versions without
 *              any insight.
 * @author Reborn1987
 */

import { useQuery } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';

import type { SendFn } from '@/hooks/use-background';
import type { LaunchpadInfo } from '@/lib/messages';
import { hasFeature, type ReleaseView } from '@/lib/release';

/** "pump.fun · on the bonding curve" / "· graduated", or why it can't be told. */
function LaunchpadLine({ mint, send }: { mint: string; send: SendFn }) {
  const q = useQuery({
    queryKey: ['token.launchpad', mint],
    queryFn: () => send({ type: 'token.launchpad', mint }) as Promise<LaunchpadInfo | null>,
    staleTime: 60_000,
    retry: 1,
  });
  let value: React.ReactNode;
  if (q.isPending) value = <span className="text-muted-foreground">Checking…</span>;
  else if (q.isError) value = <span className="text-muted-foreground">Unavailable ({q.error.message})</span>;
  else if (!q.data) value = <span className="text-muted-foreground">Not a launchpad limit recognises</span>;
  else {
    value = (
      <>
        <span className="font-semibold text-foreground">{q.data.name}</span>
        <span className={q.data.onCurve ? 'text-yellow' : 'text-buy'}> · {q.data.onCurve ? 'on the bonding curve' : 'graduated'}</span>
      </>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs">
      <Rocket className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Launched on</span> <span>{value}</span>
    </p>
  );
}

/** Insights card for one token (only the parts the account's version has). */
export function TokenInsights({ mint, send, release }: { mint: string; send: SendFn; release: ReleaseView }) {
  if (!hasFeature(release, 'launchpad')) return null;
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2.5">
      <LaunchpadLine mint={mint} send={send} />
    </div>
  );
}
