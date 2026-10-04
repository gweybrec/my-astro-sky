import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR, DIST_DIR, SWAGGER_JSON_PATH } from './server-paths.js';
import { isElectron, API_LIMIT, checkRateLimit } from './routes/shared.js';
import { logServerError } from './logger.js';
import { poiCategories } from './services.js';
import { starsRouter } from './routes/stars.js';
import { identifyRouter } from './routes/identify.js';
import { horizonRouter } from './routes/horizon.js';
import { settingsRouter } from './routes/settings.js';
import { gearRouter } from './routes/gear.js';
import { dsoOverridesRouter } from './routes/dso-overrides.js';
import { poiCategoriesRouter } from './routes/poi-categories.js';
import { skyRegionsRouter } from './routes/sky-regions.js';
import { plansRouter } from './routes/plans.js';
import { photosRouter } from './routes/photos.js';
import { solvedImportRouter } from './routes/solved-import.js';
import { localSolveRouter } from './routes/local-solve.js';
import { novaSolveRouter } from './routes/nova-solve.js';
import { backupRouter } from './routes/backup.js';

// In case we need to clear the cache during development, we can do it from the main process before loading the app.
// import { app as electronApp, session } from 'electron';
// electronApp.whenReady().then(async () => {
// await session.defaultSession.clearCache();
// });

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();

// Set TRUST_PROXY=1 when running behind a reverse proxy (nginx, Caddy) so Express
// reads the real client IP from X-Forwarded-For. Not needed in Electron (localhost only).
if (!isElectron && (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true')) {
  app.set('trust proxy', 1);
}

const enableSwagger =
  process.env.NODE_ENV !== 'production' && process.env.ENABLE_SWAGGER !== 'false';

// All non-CSP helmet protections (X-Content-Type-Options, X-Frame-Options, etc.).
app.use(helmet({ contentSecurityPolicy: false }));

// Content-Security-Policy. Served by this Express instance for both the web/Docker
// deployment and the Electron renderer (Electron loads http://localhost), so one header
// covers both. `script-src 'self'` is the key protection — Vue SFCs compile at build time,
// so no inline/eval scripts are needed. `'unsafe-inline'` is kept for inline *style*
// attributes only (nonces don't apply to style attributes). `upgrade-insecure-requests`
// is deliberately omitted (useDefaults:false) so plain-HTTP LAN access keeps working.
const csp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
  },
});
// Swagger UI (dev only, /api/docs) ships inline assets that a strict CSP would block.
app.use((req, res, next) => (req.path.startsWith('/api/docs') ? next() : csp(req, res, next)));

app.use(compression());
app.use(express.json()); // Parse JSON request bodies

// In production, serve the built frontend
if (fs.existsSync(DIST_DIR)) {
  // Long cache for hashed assets and catalog data, no cache for index.html
  app.use(
    '/assets',
    express.static(path.join(DIST_DIR, 'assets'), {
      etag: true,
      lastModified: true,
    }),
  );
  app.use(
    '/data',
    express.static(path.join(DIST_DIR, 'data'), {
      etag: true,
      lastModified: true,
      // maxAge defaults to 0, which means "always revalidate"
    }),
  );
  app.use(express.static(DIST_DIR, { maxAge: 0 }));
}

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// Rate limiting on /api routes — skipped in Electron (single-user local app)
app.use('/api', (req, res, next) => {
  if (isElectron) {
    next();
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip, API_LIMIT)) {
    res
      .status(429)
      .json({ error: 'Trop de requêtes, réessayez dans un instant', code: 'RATE_LIMIT' });
    return;
  }
  next();
});

// Domain routers (one file per domain under server/routes/), mounted without a prefix.
app.use(starsRouter);
app.use(identifyRouter);
app.use(horizonRouter);
app.use(settingsRouter);
app.use(gearRouter);
app.use(dsoOverridesRouter);
app.use(poiCategoriesRouter);
app.use(skyRegionsRouter);
app.use(plansRouter);
app.use(photosRouter);
app.use(solvedImportRouter);
app.use(localSolveRouter);
app.use(novaSolveRouter);
app.use(backupRouter);

// createApp is async so swagger routes are always registered before the SPA catch-all,
// guaranteeing correct ordering regardless of dist/ presence. It does not listen: the
// entry point (server/index.ts) does.
export async function createApp(): Promise<express.Express> {
  // First run: give the user the default POI categories before any route can list them.
  await poiCategories.ensureDefaults();

  // swagger: dev only — not available in Electron/production (swagger-ui-express is a devDependency
  // and swagger.json is not embedded in the Electron bundle).
  if (enableSwagger) {
    const swaggerJsonPath = SWAGGER_JSON_PATH;
    if (fs.existsSync(swaggerJsonPath)) {
      try {
        const { default: swaggerUi } = await import('swagger-ui-express');
        const swaggerSpec = JSON.parse(await fs.promises.readFile(swaggerJsonPath, 'utf8'));
        app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
        app.get('/api/docs/swagger.json', (_req, res) => {
          res.json(swaggerSpec);
        });
        console.log('[Swagger] API docs enabled at /api/docs');
      } catch (err: any) {
        console.warn(
          '[Swagger] dev docs disabled; swagger-ui-express unavailable.',
          err?.message ?? err,
        );
      }
    } else {
      console.warn(
        '[Swagger] dev docs disabled; public/swagger.json not found. Run npm run swagger:generate.',
      );
    }
  }

  // SPA fallback — registered after swagger so the ordering is deterministic.
  // The /api guard is belt-and-suspenders: ensures API paths are never swallowed
  // by this catch-all even if a future refactor breaks the ordering again.
  if (fs.existsSync(DIST_DIR)) {
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  // Global error handler — ensures all errors (including multer) return JSON
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status ?? err.statusCode ?? 500;
    const message = err?.message ?? String(err);
    if (status >= 500) logServerError('server_unhandled_error', err);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  return app;
}
