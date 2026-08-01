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
        // Canvas painting — untestable in a unit env. Everything that *decides* what to
        // paint has been pulled out into covered modules (star-budget, dso-render-select,
        // hover-resolve, sky-hit-test, frame-controller, sky-map-events, star-sprite-atlas,
        // sky-region-draw), so what is excluded here really is just drawing plus the thin
        // SkyMap shell that wires it together.
        // NOTE: photo-overlay.ts is intentionally NOT excluded — its pure placement/
        // geometry/visibility logic lives in the covered src/photo-placement.ts, and the
        // thin DOM shell that remains reports honestly (low but real) rather than hidden.
        'src/sky-map.ts',
        'src/sky-scene-render.ts',
        'src/sky-frame-render.ts',
        'src/sky-draw.ts',
        'src/dso-draw.ts',
        'src/star-draw.ts',
        'src/frame-draw.ts',
        'src/moon-draw.ts',
        'src/body-draw.ts',
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
