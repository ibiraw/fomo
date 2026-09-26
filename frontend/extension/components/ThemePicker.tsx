/**
 * @file ThemePicker.tsx
 * @description Theme swatches. Choosing one recolors fomo.family and the Limit panel in every open tab.
 * @author Reborn1987
 */

import { Check } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

/** Grid of theme buttons; `compact` shows dots only (for the Limit panel). */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const [theme, choose] = useTheme();

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme.id === t.id}
            title={t.name}
            onClick={() => void choose(t.id)}
            className={cn('size-6 rounded-full border-2 transition-transform hover:scale-110', theme.id === t.id ? 'border-foreground' : 'border-transparent')}
            style={{ background: `linear-gradient(135deg, ${t.bg} 0 50%, ${t.brand} 50% 100%)` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const on = theme.id === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => void choose(t.id)}
            className={cn('relative overflow-hidden rounded-lg border p-2 text-left transition-colors', on ? 'border-foreground' : 'border-border hover:border-muted-foreground')}
            style={{ background: t.bg }}
          >
            <div className="flex gap-1">
              {[t.surface, t.brand, t.action, t.buy, t.sell].map((c, i) => (
                <span key={i} className="size-3 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <div className="mt-1.5 truncate text-[11px] font-semibold" style={{ color: t.text }}>{t.name}</div>
            {on && <Check className="absolute right-1.5 top-1.5 size-3.5" style={{ color: t.brand }} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
