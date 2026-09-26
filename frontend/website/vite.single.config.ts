/**
 * @file vite.single.config.ts
 * @description Builds single/index.html into ONE self-contained file (dist-artifact/index.html).
 *              Usage: npx vite build --config vite.single.config.ts
 * @author Reborn1987
 */
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'single',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: '../dist-artifact', emptyOutDir: true },
});
