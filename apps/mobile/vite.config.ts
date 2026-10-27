import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(fromHere('../../package.json'), 'utf-8')) as {
  version: string;
  author?: { name?: string; email?: string } | string;
  license?: string;
};
const author = typeof pkg.author === 'object' ? pkg.author : { name: pkg.author };

// The phone app. `webDir` of Capacitor is `dist`. In a desktop browser the app talks to the desktop's server
// (port 3001, or the address in MOBILE_API_TARGET) through this proxy, so a screen can be developed in a phone-sized browser window.
const apiTarget = process.env.MOBILE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [vue()],
  // The app's version, written by the release process in the repository's package.json, and what the "À propos" page
  // shows with it, as the desktop's build injects them.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __APP_AUTHOR_NAME__: JSON.stringify(author.name ?? ''),
    __APP_AUTHOR_EMAIL__: JSON.stringify(author.email ?? ''),
    __APP_LICENSE__: JSON.stringify(pkg.license ?? ''),
  },
  resolve: {
    // The SVG files of the desktop's icon set, imported from the same files (one source).
    alias: { '@icons': fromHere('../../src/icons') },
  },
  server: {
    port: 5174,
    // The desktop's icons (`@icons`) live outside this folder.
    fs: { allow: ['../..'] },
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget,
      '/data': apiTarget,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
