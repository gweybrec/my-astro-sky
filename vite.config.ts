import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from '@unocss/vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
  author?: { name?: string; email?: string } | string;
  license?: string;
};
const authorName = typeof pkg.author === 'object' ? (pkg.author.name ?? '') : (pkg.author ?? '');
const authorEmail = typeof pkg.author === 'object' ? (pkg.author.email ?? '') : '';
const buildTimestamp = new Date().toISOString();

export default defineConfig({
  plugins: [UnoCSS(), vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    __APP_AUTHOR_NAME__: JSON.stringify(authorName),
    __APP_AUTHOR_EMAIL__: JSON.stringify(authorEmail),
    __APP_LICENSE__: JSON.stringify(pkg.license ?? ''),
  },
  build: {
    // The app loads from disk (Electron) or a local server, so one large chunk costs nothing
    // noticeable; the limit sits above today's ~1.3 MB main chunk to flag marked growth only.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // platform-init.ts imports src/api and star-catalog lazily on purpose (the Vitest setup
        // loads it, and a static import would run before each test's vi.mock); harmless here.
        if (
          warning.message.includes('dynamic import will not move module into another chunk') &&
          warning.message.includes('platform-init.ts')
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3002',
      '/uploads': 'http://localhost:3002',
    },
  },
});
