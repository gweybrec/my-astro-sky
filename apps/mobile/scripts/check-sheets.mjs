// Static check, no browser: a sheet of the phone app is never drawn by hand. Every sheet is either PhoneSheet or
// PhoneMapSheet (a sheet over the map, which its PhoneMapSheetHost slides out and which refuses to be drawn without one),
// both Ionic's sheet modal, which follows the finger and slides by itself. A .vue file of apps/mobile/src that writes the sheet's own markup (the
// `.mob-sheet` section, its `.mob-map-sheet` place, or its `.mob-sheet-grab` handle) outside these two components would
// have no slide, so it fails here; each exception in ALLOWED says why it is not a sheet.
// Usage: node apps/mobile/scripts/check-sheets.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** The two components that draw a sheet. */
const SHEETS = ['components/PhoneSheet.vue', 'components/PhoneMapSheet.vue'];
/** Files that use one of the classes for something that is not a sheet, with the reason. */
const ALLOWED = {
  // The handle alone, shared by the two sheets and the placement mode's settings panel (which it folds).
  'components/PhoneSheetGrab.vue': ['mob-sheet-grab'],
};
// A class attribute (static or bound) naming the sheet itself, its place over the map, or its handle.
const MARKUP = /class="[^"]*\b(mob-sheet|mob-map-sheet|mob-sheet-grab)\b(?![-\w])/g;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return e.name.endsWith('.vue') ? [p] : [];
  });
}

const problems = [];
for (const file of files(src)) {
  const rel = path.relative(src, file).replaceAll('\\', '/');
  if (SHEETS.includes(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const template = text.slice(text.indexOf('<template>'));
  for (const m of template.matchAll(MARKUP)) {
    if (ALLOWED[rel]?.includes(m[1])) continue;
    const line = text.slice(0, text.indexOf('<template>') + m.index).split('\n').length;
    problems.push(
      `${rel}:${line}  .${m[1]} drawn by hand: use PhoneSheet or PhoneMapSheet (it slides in and out)`,
    );
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`check-sheets: ${problems.length} sheet(s) drawn by hand`);
  process.exit(1);
}
console.log('check-sheets: every sheet is a PhoneSheet or a PhoneMapSheet');
