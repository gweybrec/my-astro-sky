/**
 * The one place the app knows which backend it runs on. `src/api.ts` calls `getBackend()`; the desktop
 * and the web build get the HTTP backend by default (created on first use, so nothing happens at import
 * time), the phone build installs the local backend with `setBackend` at start-up.
 */
import type { Backend } from '@myastrosky/core/backend';
import { createHttpBackend } from '@myastrosky/backend-http/http-backend';
import { getLang } from './i18n';
import { downloadBlob } from './file-utils';

let current: Backend | null = null;

export function setBackend(backend: Backend): void {
  current = backend;
}

export function getBackend(): Backend {
  current ??= createHttpBackend({
    lang: getLang,
    saveFile: (name, blob) => downloadBlob(blob, name),
  });
  return current;
}
