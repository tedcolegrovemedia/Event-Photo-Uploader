// Rasterizes apps/desktop/build/icon.svg into icon.png (1024) and icon.icns.
//
// The SVG is treated as full-bleed artwork: it is scaled to the 824 px body of
// the 1024 px macOS icon grid, clipped to the continuous-corner rounded square
// and centred, so it sits in the Dock at the same size as Apple's own icons.
//
//   node scripts/make-icon.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const build = new URL('../apps/desktop/build/', import.meta.url).pathname;
const svg = readFileSync(join(build, 'icon.svg'));

const CANVAS = 1024;
const BODY = 824;
const RADIUS = 186;

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BODY}" height="${BODY}">
     <rect width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="#fff"/>
   </svg>`,
);

const body = await sharp(svg, { density: 400 })
  .resize(BODY, BODY, { fit: 'cover' })
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer();

const master = await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: body, left: (CANVAS - BODY) / 2, top: (CANVAS - BODY) / 2 }])
  .png()
  .toBuffer();

await sharp(master).toFile(join(build, 'icon.png'));

const iconset = mkdtempSync(join(tmpdir(), 'icon-')) + '.iconset';
execFileSync('mkdir', ['-p', iconset]);
for (const px of [16, 32, 128, 256, 512]) {
  await sharp(master).resize(px, px).png().toFile(join(iconset, `icon_${px}x${px}.png`));
  await sharp(master).resize(px * 2, px * 2).png().toFile(join(iconset, `icon_${px}x${px}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);
rmSync(iconset, { recursive: true, force: true });
console.log('wrote icon.png and icon.icns');
