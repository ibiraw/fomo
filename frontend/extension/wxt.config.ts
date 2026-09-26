/**
 * @file wxt.config.ts
 * @description WXT build config and manifest for the auto fomo extension (version comes from package.json).
 * @author Reborn1987
 */

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'auto fomo',
    description: 'Limit, take-profit and stop-loss orders for fomo.family. Unofficial — not affiliated with fomo.',
    permissions: ['storage', 'tabs', 'alarms', 'scripting', 'offscreen'],
    host_permissions: ['https://fomo.family/*', 'https://x.com/*'],
  },
});
