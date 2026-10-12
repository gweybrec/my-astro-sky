// Takes a screenshot of the phone's screen (adb exec-out screencap -p) into a folder under .playwright-mcp/.
// Captures are never committed: that folder is git-ignored, and any other folder is refused.
// Usage: node screenshot.mjs --serial <serial> --dir <folder under .playwright-mcp> --name <file name without .png>
// Example: node screenshot.mjs --serial ABC123 --dir .playwright-mcp/mobile-check --name settings-portrait
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adb, parseArgs, repoRoot } from './adb.mjs';

const { options } = parseArgs(process.argv.slice(2));
if (!options.serial || !options.dir || !options.name) {
  console.error(
    'Usage: screenshot.mjs --serial <serial> --dir <folder under .playwright-mcp> --name <name>',
  );
  process.exit(2);
}
const dir = path.resolve(repoRoot, options.dir);
const allowed = path.join(repoRoot, '.playwright-mcp') + path.sep;
if (!(dir + path.sep).startsWith(allowed)) {
  console.error('Refused: screen captures go under .playwright-mcp/ only (never into git).');
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const png = adb(options.serial, ['exec-out', 'screencap', '-p'], { binary: true });
const file = path.join(dir, `${options.name}.png`);
writeFileSync(file, png);
console.log(`${file} (${png.length} bytes)`);
