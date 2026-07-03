/**
 * Generates platform-specific icon files from public/icon.png.
 * Output: build/icons/icon.png  (Linux)
 *         build/icons/icon.ico  (Windows)
 *         build/icons/icon.icns (macOS)
 *
 * Usage: npm run generate-icons
 * Run once before `npm run electron:make`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import png2icons from 'png2icons';

const src = readFileSync('public/icon.png');

mkdirSync('build/icons', { recursive: true });

// Linux — copy PNG as-is
writeFileSync('build/icons/icon.png', src);
console.log('✓ build/icons/icon.png');

// Docs site — keep in sync with public/icon.png. Commit this alongside icon changes:
// ci.yml fails the build if the two drift, since GitHub Pages has no build step to
// regenerate it at deploy time.
writeFileSync('docs/icon.png', src);
console.log('✓ docs/icon.png');

// Windows — ICO (embeds sizes 16 → 256)
const ico = png2icons.createICO(src, png2icons.BILINEAR, 0, true, true);
if (!ico) throw new Error('ICO conversion failed');
writeFileSync('build/icons/icon.ico', ico);
console.log('✓ build/icons/icon.ico');

// macOS — ICNS
const icns = png2icons.createICNS(src, png2icons.BILINEAR, 0);
if (!icns) throw new Error('ICNS conversion failed');
writeFileSync('build/icons/icon.icns', icns);
console.log('✓ build/icons/icon.icns');

console.log('\nDone. Icons ready in build/icons/');
