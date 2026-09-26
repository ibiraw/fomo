/**
 * @file FieldBox.tsx
 * @description FOMO-style input: small uppercase label inside on the left, value, and a unit suffix.
 * @author Reborn1987
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  readonly label: ReactNode;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly suffix?: ReactNode;
  readonly className?: string;
}

/** Labeled numeric field. */
export function FieldBox({ label, value, onChange, placeholder, suffix, className }: Props) {
  return (
    <label className={cn('flex h-11 items-center gap-3 rounded-xl bg-secondary px-3 focus-within:ring-1 focus-within:ring-ring', className)}>
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-faint"
      />
      {suffix}
    </label>
  );
}
