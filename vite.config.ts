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
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
});
