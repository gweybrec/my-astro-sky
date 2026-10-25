import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // The phone app imports the desktop's SVG icon files through this alias (see apps/mobile/vite.config.ts).
  resolve: { alias: { '@icons': fileURLToPath(new URL('./src/icons', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup/platform.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/components/**/*.test.ts',
      'apps/mobile/tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/**/*.ts',
        'src/**/*.vue',
        'server/**/*.ts',
        'packages/**/*.ts',
        'apps/mobile/src/**/*.ts',
        'apps/mobile/src/**/*.vue',
      ],
      exclude: [
        // Entry points
        'src/ui.ts',
        'src/main.ts',
        'apps/mobile/src/main.ts',
        'src/style.css',
        // Type-only files
        '**/*.d.ts',
        // Shared test suites that the backend tests run, not app code
        'packages/core/src/testing/**',
        // Canvas painting — untestable in a unit env. Everything that *decides* what to
        // paint has been pulled out into covered modules (star-budget, dso-render-select,
        // hover-resolve, sky-hit-test, frame-controller, sky-map-events, star-sprite-atlas,
        // sky-region-draw), so what is excluded here really is just drawing plus the thin
        // SkyMap shell that wires it together.
        // NOTE: src/photo-overlay.ts is intentionally NOT excluded — its pure placement/
        // geometry/visibility logic lives in the covered packages/core/src/photo-placement.ts,
        // and the thin DOM shell that remains reports honestly (low but real) rather than hidden.
        // tests/unit/vitest-config.test.ts fails when a path listed here no longer exists.
        'packages/render/src/sky-map.ts',
        'packages/render/src/sky-scene-render.ts',
        'packages/render/src/sky-frame-render.ts',
        'packages/render/src/sky-draw.ts',
        'packages/render/src/dso-draw.ts',
        'packages/render/src/star-draw.ts',
        'packages/render/src/frame-draw.ts',
        'packages/render/src/moon-draw.ts',
        'packages/render/src/body-draw.ts',
        'src/targets-view.ts',
        'src/metadata-editor.ts',
        'src/toast.ts',
        // Fetch-only loaders (no logic beyond HTTP)
        'src/star-catalog.ts',
        'src/api.ts',
        // Express server, subprocess, and file-I/O — integration-only
        'server/index.ts',
        'server/app.ts',
        'server/routes/**',
        'server/astap.ts',
      ],
    },
  },
});
