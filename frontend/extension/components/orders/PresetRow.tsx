/**
 * @file PresetRow.tsx
 * @description Amount presets with a unit switch and a pencil that turns presets into editable boxes.
 * @author Reborn1987
 */

import { Check, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AmountUnit } from '@/hooks/use-presets';
import { cleanNumberInput } from '@/lib/number-input';
import { cn } from '@/lib/utils';

interface Props {
  readonly presets: number[];
  readonly unit: AmountUnit;
  readonly selected: number | null;
  readonly onPick: (v: number) => void;
  readonly onUnitToggle: () => void;
  readonly onSave: (values: number[]) => Promise<void>;
}

const cell = 'flex h-9 items-center justify-center rounded-lg bg-secondary text-sm transition-colors';

/** "10 | 25 | 50 | 100 | % | ✎" row. */
export function PresetRow({ presets, unit, selected, onPick, onUnitToggle, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(presets.map(String));
  useEffect(() => setDraft(presets.map(String)), [presets]);

  const finish = (): void => {
    void onSave(draft.map(Number)).then(() => setEditing(false));
  };

  return (
    <div className="grid grid-cols-[repeat(4,1fr)_2.25rem_2.25rem] gap-1.5">
      {editing
        ? draft.map((v, i) => (
            <input
              key={i}
              aria-label={`Preset ${i + 1}`}
              inputMode="decimal"
              value={v}
              onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? cleanNumberInput(e.target.value, x) : x)))}
              className={cn(cell, 'w-full min-w-0 text-center text-foreground outline-none ring-1 ring-ring')}
            />
          ))
        : presets.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onPick(v)}
              className={cn(cell, selected === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              {v}
            </button>
          ))}
      <button type="button" onClick={onUnitToggle} title="Switch between $ and %" className={cn(cell, 'font-semibold text-foreground hover:bg-accent')}>
        {unit === 'usd' ? '$' : '%'}
      </button>
      <button
        type="button"
        onClick={() => (editing ? finish() : setEditing(true))}
        title={editing ? 'Save presets' : 'Edit presets'}
        className={cn(cell, editing ? 'text-buy hover:bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
      >
        {editing ? <Check className="size-4" /> : <Pencil className="size-3.5" />}
      </button>
    </div>
  );
}
