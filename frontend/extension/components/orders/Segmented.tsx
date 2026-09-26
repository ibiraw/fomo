/**
 * @file Segmented.tsx
 * @description Tap-to-select button group. Used instead of dropdowns because dropdown menus render in a
 *              portal outside the shadow root on the FOMO page and would lose their styles.
 * @author Reborn1987
 */

import { cn } from '@/lib/utils';

interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface Props<T extends string> {
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (v: T) => void;
  readonly className?: string;
}

/** Row of mutually exclusive buttons. */
export function Segmented<T extends string>({ value, options, onChange, className }: Props<T>) {
  return (
    <div role="radiogroup" className={cn('flex rounded-md bg-secondary p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
