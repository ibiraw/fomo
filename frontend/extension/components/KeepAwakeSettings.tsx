/**
 * @file KeepAwakeSettings.tsx
 * @description Settings section: keep the computer awake while orders are waiting (on by default).
 * @author Reborn1987
 */

import { Segmented } from '@/components/orders/Segmented';
import { SettingsCard } from '@/components/SettingsCard';
import { useKeepAwake } from '@/hooks/use-keep-awake';

/** On/off for keeping the computer awake while orders wait. */
export function KeepAwakeSettings() {
  const [on, save] = useKeepAwake();
  return (
    <SettingsCard className="space-y-2">
      <h2 className="text-sm font-semibold">Keep computer awake</h2>
      <p className="text-xs text-muted-foreground">
        While you have orders waiting, your computer won't go to sleep, so they can still trade. The screen can still
        turn off. Turn it off to save battery; orders can't trade while the computer sleeps.
      </p>
      <Segmented
        value={on ? 'on' : 'off'}
        onChange={(v) => void save(v === 'on')}
        options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
      />
    </SettingsCard>
  );
}
