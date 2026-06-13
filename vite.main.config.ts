import { readFileSync } from 'fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
  author?: { name?: string; email?: string } | string;
  license?: string;
};
const buildTimestamp = new Date().toISOString();

// Vite config for the Electron main process bundle.
// electron-forge / VitePlugin calls this when building target: 'main'.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  build: {
    rollupOptions: {
      // Native modules can't be bundled — they must stay as external requires
      // so that @electron-forge/plugin-auto-unpack-natives can handle their .node files.
      external: ['better-sqlite3', 'sharp'],
    },
    sourcemap: true,
    minify: false,
  },
});
