import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The phone app. `webDir` of Capacitor is `dist`. In a desktop browser the app talks to the desktop's server
// (port 3001) through this proxy, so a screen can be developed in a phone-sized browser window.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // The SVG files of the desktop's icon set, imported from the same files (one source).
    alias: { '@icons': fromHere('../../src/icons') },
  },
  server: {
    port: 5174,
    // `design/mobile/ds` (the design system) lives outside this folder.
    fs: { allow: ['../..'] },
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/data': 'http://localhost:3001',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
