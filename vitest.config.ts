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
        // DOM/Canvas rendering — untestable in a unit env.
        // NOTE: photo-overlay.ts is intentionally NOT excluded — its pure placement/
        // geometry/visibility logic lives in the covered src/photo-placement.ts, and the
        // thin DOM shell that remains reports honestly (low but real) rather than hidden.
        'src/sky-map.ts',
        'src/sky-draw.ts',
        'src/dso-draw.ts',
        'src/star-draw.ts',
        'src/frame-draw.ts',
        'src/moon-draw.ts',
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
