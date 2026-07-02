import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'tests/components/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.vue', 'server/**/*.ts'],
      exclude: [
        // Entry points
        'src/ui.ts',
        'src/main.ts',
        'src/style.css',
        // Type-only files
        'src/app-meta.d.ts',
        'src/types.ts',
        // DOM/Canvas rendering — untestable in a unit env
        'src/photo-overlay.ts',
        'src/sky-map.ts',
        'src/sky-draw.ts',
        'src/targets-view.ts',
        'src/metadata-editor.ts',
        'src/toast.ts',
        // Fetch-only loaders (no logic beyond HTTP)
        'src/star-catalog.ts',
        'src/api.ts',
        // Express server, subprocess, and file-I/O — integration-only
        'server/index.ts',
        'server/astap.ts',
      ],
    },
  },
});
