// @vitest-environment node
/** The server prints its debug and info messages outside production only (the packaged desktop app runs in production). */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';

let uploadsDir: string | undefined;
let closeDatabase: (() => void) | undefined;

async function startApp(nodeEnv: string) {
  vi.resetModules();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-sink-'));
  vi.stubEnv('DB_PATH', ':memory:');
  vi.stubEnv('UPLOADS_DIR', uploadsDir);
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('ENABLE_SWAGGER', 'false');
  await (await import('../../server/app.js')).createApp();
  closeDatabase = (await import('../../server/db.js')).closeDatabase;
  return import('@myastrosky/core/platform/log');
}

afterEach(() => {
  closeDatabase?.();
  closeDatabase = undefined;
  vi.unstubAllEnvs();
  if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
  uploadsDir = undefined;
});

describe('server log sink', () => {
  it('prints nothing in production', async () => {
    const log = await startApp('production');
    expect(log.isLogEnabled()).toBe(false);
  });

  it('prints in development', async () => {
    const log = await startApp('development');
    expect(log.isLogEnabled()).toBe(true);
  });
});
