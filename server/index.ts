import 'dotenv/config';
import { createApp } from './app.js';
import { logInfo, logNotice } from '@myastrosky/core/platform/log';

async function startServer() {
  const app = await createApp();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
    // Printed in every build, so a Docker or Node.js install shows it started.
    logNotice('Server', `Serveur démarré sur http://localhost:${PORT}`);
    logInfo('Server', `Star catalog: ${catalogPath}`);
  });
}

startServer();
