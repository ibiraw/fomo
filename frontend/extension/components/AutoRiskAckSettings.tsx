/**
 * @file AutoRiskAckSettings.tsx
 * @description Settings section: auto-tick fomo's "I understand the risks" warning on the Buy tab (off by default).
 * @author Reborn1987
 */

import { Segmented } from '@/components/orders/Segmented';
import { SettingsCard } from '@/components/SettingsCard';
import { useStoredFlag } from '@/hooks/use-stored-flag';
import { AUTO_RISK_ACK_KEY, DEFAULT_AUTO_RISK_ACK, parseAutoRiskAck } from '@/lib/risk-ack';

/** On/off for ticking fomo's risk warning automatically. */
export function AutoRiskAckSettings() {
  const [on, save] = useStoredFlag(AUTO_RISK_ACK_KEY, parseAutoRiskAck, DEFAULT_AUTO_RISK_ACK);
  return (
    <SettingsCard className="space-y-2">
      <h2 className="text-sm font-semibold">Auto-tick fomo's risk warning</h2>
      <p className="text-xs text-muted-foreground">
        Some coins show "Warning: … issues" above Buy, and Buy stays off until you tick "I understand the risks". With this
        on, limit ticks it for you the moment it appears on the Buy tab, so you don't lose seconds on a launch. You're still
        agreeing to the warning: read the issues if you're unsure. It never presses Buy for you.
      </p>
      <Segmented
        value={on ? 'on' : 'off'}
        onChange={(v) => void save(v === 'on')}
        options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
      />
    </SettingsCard>
  );
}
