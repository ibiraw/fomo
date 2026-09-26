/**
 * @file icons.mjs
 * @description Renders the extension icons (public/icon/*.png) from assets/icon.svg (16px uses the simplified
 *              assets/icon-small.svg). Uses sharp from the website package. Usage: node scripts/icons.mjs
 * @author Reborn1987
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const sharp = createRequire(import.meta.url)('../../website/node_modules/sharp');
const big = readFileSync('assets/icon.svg');
const small = readFileSync('assets/icon-small.svg');
for (const size of [16, 32, 48, 96, 128]) {
  await sharp(size <= 16 ? small : big, { density: 72 * Math.max(1, size / 16) }).resize(size, size).png().toFile(`public/icon/${size}.png`);
}
console.log('icons written to public/icon/');
