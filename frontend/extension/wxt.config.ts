/**
 * @file wxt.config.ts
 * @description WXT build config and manifest for the FOMO Limit Orders extension.
 * @author Reborn1987
 */

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'FOMO Limit Orders',
    description: 'Limit, take-profit and stop-loss orders for fomo.family.',
    permissions: ['storage', 'tabs', 'alarms', 'scripting'],
    host_permissions: ['https://fomo.family/*'],
  },
});
