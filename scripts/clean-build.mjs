import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const targets = [
  '.vite',
  'dist',
  'out',
  // Vite & plugin caches that may cause stale bundles
  'node_modules/.vite',
  'node_modules/.cache',
  'node_modules/.cache/jiti',
  'node_modules/.cache/vite',
  '.vite-temp',
];

for (const target of targets) {
  const fullPath = path.join(rootDir, '..', target);
  try {
    if (!fs.existsSync(fullPath)) {
      // log that nothing was present
      console.log(`not found: ${target}`);
      continue;
    }

    // If it's a file, remove it; if directory, remove recursively.
    fs.rmSync(fullPath, { recursive: true, force: true });

    // If the target still exists (on Windows a handle may prevent removal), report it.
    if (!fs.existsSync(fullPath)) console.log(`removed ${target}`);
    else console.warn(`could not remove (locked?): ${target}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn(`skip ${target}: ${err.code || err.message}`);
  }
}
