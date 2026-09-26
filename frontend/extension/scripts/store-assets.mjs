/**
 * @file store-assets.mjs
 * @description Renders Chrome Web Store graphics into store/assets/: the 128px store icon (96px artwork, 16px
 *              transparent padding) and the 440×280 promo tile. Uses sharp from the website package.
 *              Usage: node scripts/store-assets.mjs
 * @author Reborn1987
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const sharp = createRequire(import.meta.url)('../../website/node_modules/sharp');
const icon = readFileSync('assets/icon.svg');

const art = await sharp(icon, { density: 144 }).resize(96, 96).png().toBuffer();
await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: art, left: 16, top: 16 }]).png().toFile('store/assets/store-icon-128.png');

const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#09090b"/>
  <line x1="36" x2="404" y1="206" y2="206" stroke="#ffbf17" stroke-width="3" stroke-dasharray="9 7"/>
  <polyline fill="none" stroke="#22c55e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" points="36,150 110,160 170,142 240,176 300,168 366,206"/>
  <circle cx="366" cy="206" r="8" fill="#fafafa"/>
  <text x="36" y="78" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="800" fill="#fafafa">auto <tspan fill="#ffbf17">fomo</tspan></text>
  <text x="38" y="112" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#a1a1aa">Limit orders for fomo.family</text>
</svg>`;
await sharp(Buffer.from(tile)).png().toFile('store/assets/promo-440x280.png');
console.log('store assets written to store/assets/');
