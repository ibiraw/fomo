/**
 * @file OrderSounds.tsx
 * @description Settings section for order sounds (Arcade pack): on/off, volume, and a preview button per sound.
 * @author Reborn1987
 */

import { Play } from 'lucide-react';
import { useRef } from 'react';

import { Segmented } from '@/components/orders/Segmented';
import { Slider } from '@/components/ui/slider';
import { useSoundSettings } from '@/hooks/use-sound-settings';
import { ArcadePlayer, SOUND_EVENTS, type SoundEvent } from '@/lib/sounds';

/** Dot color per event, matching the order list's buy / take-profit / stop-loss colors. */
const EVENT_COLOR: Record<SoundEvent, string> = {
  buy: 'bg-buy',
  tp: 'bg-yellow',
  sl: 'bg-sell',
  fail: 'bg-muted-foreground',
};

/** On/off, volume and previews. Previews play here in the popup; real fills play from the background. */
export function OrderSounds() {
  const [settings, save] = useSoundSettings();
  const player = useRef<ArcadePlayer | null>(null);

  /** Plays one sound at the chosen volume. */
  const preview = (event: SoundEvent): void => {
    player.current ??= new ArcadePlayer();
    void player.current.play(event, settings.volume);
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Order sounds</h2>
      <p className="text-xs text-muted-foreground">Arcade blips when an order fills or fails.</p>
      <Segmented
        value={settings.enabled ? 'on' : 'off'}
        onChange={(v) => void save({ enabled: v === 'on' })}
        options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
      />
      <div className={settings.enabled ? 'space-y-2' : 'pointer-events-none space-y-2 opacity-50'} aria-disabled={!settings.enabled}>
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
        <div className="grid grid-cols-2 gap-1.5">
          {SOUND_EVENTS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => preview(e.id)}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-left text-xs font-medium transition-colors hover:border-foreground/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className={`grid size-4 shrink-0 place-items-center rounded-full ${EVENT_COLOR[e.id]} text-background`}>
                <Play className="size-2.5 fill-current" aria-hidden />
              </span>
              {e.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
