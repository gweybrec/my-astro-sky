// @vitest-environment node
/**
 * Runs the backend contract on the HTTP backend. The real Express application runs on a temporary
 * database and upload folder, listening on a free port of 127.0.0.1 like the route pinning tests, and
 * `createHttpBackend` talks to it with the real `fetch`. There is no `XMLHttpRequest` in Node, so the
 * two uploads with progress go through the `upload` option, answered by a `fetch`-based function.
 * The sites the server reaches out to are answered from recorded files (see the helper).
 */
import { afterAll } from 'vitest';
import { describeBackendContract } from '../helpers/backend-contract';
import { startHttpApp, type RunningApp } from '../helpers/http-contract-app';

const apps: RunningApp[] = [];
let shared: RunningApp | undefined;

afterAll(async () => {
  for (const app of apps) await app.close();
});

describeBackendContract('HTTP backend', async (options) => {
  if (options?.isolated) {
    const own = await startHttpApp();
    apps.push(own);
    return own;
  }
  if (!shared) {
    shared = await startHttpApp();
    apps.push(shared);
  }
  await shared.reset();
  return shared;
});
