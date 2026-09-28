/**
 * @file TokenInsights.tsx
 * @description Facts about the token on the page, shown in the Limit panel and the popup: where it was launched
 *              and whether it is still on the launchpad's bonding curve (v1.8); the top 10 holders' share of supply
 *              and what the dev holds (v1.9, refreshed every 30 s). Renders nothing for versions without any insight.
 * @author Reborn1987
 */

import { useIsFetching, useQueryClient, useQuery } from '@tanstack/react-query';
import { Rocket, UserRound, Users } from 'lucide-react';

import { RefreshButton } from '@/components/RefreshButton';
import type { SendFn } from '@/hooks/use-background';
import { curveStatusFromSource } from '@/lib/format';
import type { LaunchpadInfo, TokenMetricsInfo } from '@/lib/messages';
import type { PriceTick } from '@/lib/types';
import { hasFeature, type ReleaseView } from '@/lib/release';

/**
 * "pump.fun · bonding curve" / "· graduated". When limit doesn't recognise the launchpad, the name fomo shows next to
 * the token (`pageLaunchpad`, Limit panel only) is used instead, with the status judged from where the token's live
 * price comes from (a curve, or a DEX pool it graduated to).
 */
function LaunchpadLine({ mint, send, pageLaunchpad, priceSource }: { mint: string; send: SendFn; pageLaunchpad: string | null; priceSource: PriceTick['source'] | null }) {
  const q = useQuery({
    queryKey: ['token.launchpad', mint],
    queryFn: () => send({ type: 'token.launchpad', mint }) as Promise<LaunchpadInfo | null>,
    staleTime: 60_000,
    retry: 1,
  });
  let value: React.ReactNode;
  if (q.isPending) value = <span className="text-muted-foreground">Checking…</span>;
  else if (q.isError) value = <span className="text-muted-foreground">Unavailable ({q.error.message})</span>;
  else if (!q.data && pageLaunchpad) {
    const status = curveStatusFromSource(priceSource);
    value = (
      <>
        <span className="font-semibold text-foreground">{pageLaunchpad}</span>
        {status && <span className={status === 'curve' ? 'text-yellow' : 'text-buy'}> · {status === 'curve' ? 'bonding curve' : 'graduated'}</span>}
      </>
    );
  }
  else if (!q.data) value = <span className="text-muted-foreground">Not a launchpad limit recognises</span>;
  else {
    value = (
      <>
        <span className="font-semibold text-foreground">{q.data.name}</span>
        <span className={q.data.onCurve ? 'text-yellow' : 'text-buy'}> · {q.data.onCurve ? 'bonding curve' : 'graduated'}</span>
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

/** "12.4%" with its risk color: concentrated supply is red, moderate yellow, spread out green. */
function Share({ pct, warnAt, badAt }: { pct: number; warnAt: number; badAt: number }) {
  const color = pct >= badAt ? 'text-sell' : pct >= warnAt ? 'text-yellow' : 'text-buy';
  return <span className={`font-semibold tabular-nums ${color}`}>{pct < 0.01 && pct > 0 ? '<0.01' : pct.toFixed(pct < 10 ? 2 : 1)}%</span>;
}

/** Top 10 holders' share and the dev's holdings. */
function MetricsLines({ mint, send }: { mint: string; send: SendFn }) {
  const q = useQuery({
    queryKey: ['token.metrics', mint],
    queryFn: () => send({ type: 'token.metrics', mint }) as Promise<TokenMetricsInfo>,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <p className="flex items-center gap-1.5 text-xs">
      {icon}
      <span className="text-muted-foreground">{label}</span> <span>{value}</span>
    </p>
  );
  const usersIcon = <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  const devIcon = <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  if (q.isPending) return row(usersIcon, 'Top 10 holders', <span className="text-muted-foreground">Counting holders… (fresh EVM tokens can take a moment)</span>);
  if (q.isError) return row(usersIcon, 'Holder data', <span className="text-muted-foreground">Unavailable ({q.error.message})</span>);
  const m = q.data;
  if (m.note === 'too-old') return row(usersIcon, 'Holder data', <span className="text-muted-foreground">Only for fresh tokens on this chain</span>);
  return (
    <>
      {m.topTenPct !== null && row(
        usersIcon,
        'Top 10 holders',
        <>
          <Share pct={m.topTenPct} warnAt={30} badAt={50} />
          {m.topHoldersPct.length > 0 && (
            <span className="tabular-nums text-muted-foreground" title="The 5 largest holders' shares of supply (%)">
              {' '}({m.topHoldersPct.map((p) => p.toFixed(1)).join(' · ')})
            </span>
          )}
        </>,
      )}
      {m.devHoldsPct === null
        ? row(devIcon, 'Dev', <span className="text-muted-foreground">Unknown (launchpad not recognised)</span>)
        : row(devIcon, m.devName ? `Dev (${m.devName}) holds` : 'Dev holds', <Share pct={m.devHoldsPct} warnAt={5} badAt={15} />)}
    </>
  );
}

/** Insights card for one token (only the parts the account's version has). */
export function TokenInsights({ mint, send, release, pageLaunchpad = null, priceSource = null }: {
  mint: string; send: SendFn; release: ReleaseView; pageLaunchpad?: string | null; priceSource?: PriceTick['source'] | null;
}) {
  const launchpad = hasFeature(release, 'launchpad');
  const metrics = hasFeature(release, 'tokenMetrics');
  const client = useQueryClient();
  const busy = useIsFetching({ predicate: (q) => (q.queryKey[0] === 'token.launchpad' || q.queryKey[0] === 'token.metrics') && q.queryKey[1] === mint }) > 0;
  if (!launchpad && !metrics) return null;
  const refresh = (): void => {
    void client.refetchQueries({ queryKey: ['token.launchpad', mint] });
    void client.refetchQueries({ queryKey: ['token.metrics', mint] });
  };
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-card p-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        {launchpad && <LaunchpadLine mint={mint} send={send} pageLaunchpad={pageLaunchpad} priceSource={priceSource} />}
        {metrics && <MetricsLines mint={mint} send={send} />}
      </div>
      <RefreshButton onClick={refresh} busy={busy} label="Refresh token info" />
    </div>
  );
}
