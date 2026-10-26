/**
 * The one place the app knows which backend it runs on. The data functions call `getBackend()`; each
 * platform installs its backend with `setBackend` at start-up (`src/platform-init.ts` on the desktop and
 * the web, the phone's own start-up on the phone). This package never imports a backend itself.
 */
import type { Backend } from '@myastrosky/core/backend';

let current: Backend | null = null;

export function setBackend(backend: Backend): void {
  current = backend;
}

export function getBackend(): Backend {
  if (!current) {
    throw new Error('No backend installed: the platform start-up must call setBackend() first.');
  }
  return current;
}
