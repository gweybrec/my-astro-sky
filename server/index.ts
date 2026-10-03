import 'dotenv/config';
import { createApp } from './app.js';

async function startServer() {
  const app = await createApp();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
    console.log(`Star catalog: ${catalogPath}`);
  });
}

startServer();
