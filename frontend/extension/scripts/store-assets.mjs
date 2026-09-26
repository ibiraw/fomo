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
  <g transform="translate(40 62) scale(2.4)">
    <ellipse cx="32" cy="36" rx="25" ry="11" fill="none" stroke="#516af6" stroke-width="3" stroke-dasharray="5 4" transform="rotate(-18 32 36)"/>
    <path d="M40 14 A16 16 0 1 0 50 38 A12 12 0 1 1 40 14 Z" fill="#fafafa"/>
  </g>
  <text x="220" y="150" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="700" fill="#fafafa">l&#x131;m&#x131;t</text>
  <circle cx="251" cy="107" r="6.5" fill="#516af6"/><circle cx="315" cy="107" r="6.5" fill="#516af6"/>
  <text x="222" y="186" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#a1a1aa">Limit orders for fomo.family</text>
</svg>`;
await sharp(Buffer.from(tile)).png().toFile('store/assets/promo-440x280.png');
console.log('store assets written to store/assets/');
