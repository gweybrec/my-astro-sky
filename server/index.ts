import 'dotenv/config';
import { createApp } from './app.js';
import { isElectron } from './routes/shared.js';
import { logServerError } from './logger.js';
import { listenOn, resolveServerPort } from './ports.js';
import { logInfo, logNotice } from '@myastrosky/core/platform/log';

async function startServer() {
  const port = resolveServerPort(process.env, isElectron);
  const app = await createApp();
  await listenOn(app, port);
  const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
  // Printed in every build, so a Docker or Node.js install shows it started.
  logNotice('Server', `Serveur démarré sur http://localhost:${port}`);
  logInfo('Server', `Star catalog: ${catalogPath}`);
}

/** Rejects when the server cannot start. Electron awaits it, so its start-up dialog shows the reason. */
export const serverStarted = startServer();

if (!isElectron) {
  serverStarted.catch((err: unknown) => {
    logServerError('server_start_failed', err);
    process.exit(1);
  });
}
