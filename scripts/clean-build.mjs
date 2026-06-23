import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
// Only the build outputs a production Electron build actually regenerates:
//   .vite — compiled main + preload bundles (package.json "main")
//   dist  — Vite-built frontend bundled into the asar / served by Express
//   out   — Forge's packaged app + installers
// The node_modules/.vite and .cache entries are dev-server / transpile caches
// that vite build does not use, so clearing them has no effect on the package.
const targets = [
  '.vite',
  'dist',
  'out',
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
