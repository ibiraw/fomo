/**
 * @file OrderSounds.tsx
 * @description Settings section for order sounds: on/off, sound theme (pack) picker, volume, and a preview button
 *              per sound. Picking a theme plays its "Buy filled" sound so it can be heard right away.
 * @author Reborn1987
 */

import { Check, Play } from 'lucide-react';
import { useRef, useState } from 'react';

import { Segmented } from '@/components/orders/Segmented';
import { Slider } from '@/components/ui/slider';
import { useSoundSettings } from '@/hooks/use-sound-settings';
import { SOUND_PACKS } from '@/lib/sound-packs';
import { SOUND_EVENTS, SoundPlayer, type SoundEvent, type SoundPackId } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { SettingsCard } from '@/components/SettingsCard';

/** Dot color per event, matching the order list's buy / take-profit / stop-loss colors. */
const EVENT_COLOR: Record<SoundEvent, string> = {
  buy: 'bg-buy',
  tp: 'bg-yellow',
  sl: 'bg-sell',
  fail: 'bg-muted-foreground',
};

/** On/off, theme, volume and previews. Previews play here in the popup; real fills play from the background. */
export function OrderSounds() {
  const [settings, save] = useSoundSettings();
  const player = useRef<SoundPlayer | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /** Plays one sound and highlights whatever triggered it while it plays. */
  const preview = (pack: SoundPackId, event: SoundEvent, marker: string): void => {
    player.current ??= new SoundPlayer();
    setProblem(null);
    player.current
      .play(pack, event, settings.volume)
      .then((seconds) => {
        setPlaying(marker);
        setTimeout(() => setPlaying((m) => (m === marker ? null : m)), seconds * 1000);
      })
      .catch((err: unknown) => setProblem(`Couldn't play the sound: ${err instanceof Error ? err.message : String(err)}`));
  };

  /** Selects a theme and plays a sample of it. */
  const choose = (pack: SoundPackId): void => {
    void save({ pack });
    preview(pack, 'buy', `pack:${pack}`);
  };

  const current = SOUND_PACKS.find((p) => p.id === settings.pack) ?? SOUND_PACKS[0]!;

  return (
    <SettingsCard className="space-y-2">
      <h2 className="text-sm font-semibold">Order sounds</h2>
      <p className="text-xs text-muted-foreground">Plays when an order fills or fails. Tap a theme to hear it.</p>
      <Segmented
        value={settings.enabled ? 'on' : 'off'}
        onChange={(v) => void save({ enabled: v === 'on' })}
        options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
      />
      <div className={cn('space-y-3', !settings.enabled && 'opacity-50')}>
        <div role="radiogroup" aria-label="Sound theme" className="grid grid-cols-2 gap-1.5">
          {SOUND_PACKS.map((p) => {
            const selected = p.id === settings.pack;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(p.id)}
                className={cn(
                  'relative cursor-pointer rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  selected ? 'border-yellow bg-yellow/10' : 'border-border bg-secondary hover:border-foreground/40 hover:bg-accent',
                  playing === `pack:${p.id}` && 'ring-1 ring-yellow',
                )}
              >
                <span className="flex items-center gap-1 text-xs font-semibold">
                  {p.name}
                  {selected && <Check className="ml-auto size-3.5 text-yellow" aria-hidden />}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">{p.vibe}</span>
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-3 text-xs">
          <span className="w-12 shrink-0 text-muted-foreground">Volume</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[Math.round(settings.volume * 100)]}
            onValueChange={([v]) => void save({ volume: (v ?? 0) / 100 })}
            aria-label="Sound volume"
          />
          <span className="w-8 text-right tabular-nums">{Math.round(settings.volume * 100)}%</span>
        </label>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Preview {current.name}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {SOUND_EVENTS.map((e) => {
              const marker = `${current.id}:${e.id}`;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => preview(current.id, e.id, marker)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border bg-secondary px-2 py-1.5 text-left text-xs font-medium transition-colors hover:border-foreground/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                    playing === marker ? 'border-foreground/60' : 'border-border',
                  )}
                >
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded-full text-background', EVENT_COLOR[e.id])}>
                    <Play className="size-2.5 fill-current" aria-hidden />
                  </span>
                  {e.label}
                </button>
              );
            })}
          </div>
        </div>
        {problem && <p role="alert" className="text-xs text-sell">{problem}</p>}
      </div>
    </SettingsCard>
  );
}
