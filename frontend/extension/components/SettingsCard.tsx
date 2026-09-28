/**
 * @file SettingsCard.tsx
 * @description One card per group in the popup's Settings tab, so each setting reads as its own block.
 *              Controls inside use the page color as their "secondary" surface, which otherwise equals the card color.
 * @author Reborn1987
 */

import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** A settings group: title, optional hint, then its controls. */
export function SettingsCard({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-xl border bg-card p-3 text-card-foreground [--color-secondary:var(--color-background)]', className)}
      {...props}
    />
  );
}
