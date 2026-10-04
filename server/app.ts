import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR, DIST_DIR, SWAGGER_JSON_PATH } from './server-paths.js';
import {
  ALLOWED_PHOTO_EXTENSIONS,
  ALLOWED_WCS_EXTENSIONS,
  isElectron,
  UPLOAD_LIMIT,
  API_LIMIT,
  checkRateLimit,
  upload,
  uploadWCS,
  uploadBundle,
  uploadRaw,
  sanitizeIntegrationRows,
} from './routes/shared.js';
import {
  poiCategoryToApi,
  skyRegionToApi,
  planEntryToApi,
  planMosaicToApi,
  PLAN_SORT_KEYS,
} from './routes/mappers.js';
import {
  getAllPhotos,
  deletePhoto,
  createPhotoWithId,
  checkPhotosExist,
  checkPhotosExistByName,
  getAllDsoOverrides,
  upsertDsoOverride as upsertDsoOverrideDB,
  getAllCustomGear,
  upsertCustomGear as upsertCustomGearDB,
  deleteCustomGear as deleteCustomGearDB,
  getAllGearSetups,
  upsertGearSetup,
  deleteGearSetup,
  sanitizePois,
  sanitizeCaptureDetails,
  getAllPoiCategories,
  upsertPoiCategory,
  getAllSkyRegions,
  upsertSkyRegion,
  getPlans,
  getAllPlanEntries,
  createPlan,
  deletePlan,
  addPlanEntry,
  sanitizeObservationWindows,
  getAllPlanMosaics,
  addPlanMosaic,
  type PlanEntryRow,
  type PlanMosaicRow,
} from './db.js';
import { ZipArchive } from 'archiver';
import { createRequire } from 'module';
// unzipper is CommonJS-only and has no ESM export, so it can't be `import`ed under
// "type": "module" — createRequire is a permanent interop shim for it, unrelated to archiver.
const _require = createRequire(import.meta.url);
const unzipper = _require('unzipper') as typeof import('unzipper');
import {
  isValidZipEntryPath,
  parseManifestPhotos,
  inspectZipContents,
  buildZipPreviewResponse,
  idsToReplaceByName,
} from './import-utils.js';
import { extractWCS, wcsToCorrespondences, loadServerCatalog } from './wcs-reader.js';
import {
  decodeRawAstroImage,
  UnsupportedRawFormatError,
  UnsupportedTiffError,
  UnsupportedFitsError,
} from './raw-decode/index.js';
import {
  submitJob,
  getJobStatus,
  isConfigured as isAstrometryConfigured,
  listUserSubmissions,
  reuseSubmission,
} from './astrometry.js';
import { solveWithASTAP } from './astap.js';
import { solveWithSolveField } from './solve-field.js';
import { createJob, getJob, updateJob, cancelJob } from './solve-queue.js';
import { msg } from './messages.js';
import type { ServerLang } from './messages.js';
import { logServerError } from './logger.js';
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

/**
 * Transform raw image coordinates to browser-display coordinates based on EXIF orientation.
 * Plate solvers process the raw JPEG bytes (no EXIF rotation), so they return coordinates
 * in raw image space. Browsers auto-apply EXIF rotation, so the upload handler expects
 * browser-display coordinates. This function bridges the gap.
 *
 * EXIF orientations 5–8 involve a 90° rotation (axes swap + possible flip):
 *   1: no-op
 *   3: rotate 180°
 *   6: raw is rotated 90°CW → browser shows 90°CCW → browser_x = origH-1-raw_y, browser_y = raw_x   (wait, see below)
 *       Actually: orientation 6 means image was shot rotated 90°CW, so browser rotates 90°CCW to fix:
 *       browser (W=H_raw, H=W_raw): browser_x = raw_y, browser_y = W_raw-1-raw_x
 *   8: raw is rotated 90°CCW → browser rotates 90°CW to fix:
 *       browser (W=H_raw, H=W_raw): browser_x = H_raw-1-raw_y, browser_y = raw_x
 */
import { rawToBrowserCoords } from './exif-utils.js';

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

/**
 * @swagger
 * /api/export:
 *   post:
 *     summary: Export photos as ZIP or metadata JSON
 *     responses:
 *       200:
 *         description: Export generated successfully
 */
// Export photos as ZIP (full) or JSON (metadata only)
// POST body: { mode: 'full' | 'metadata', ids?: string[] }
// New shape:  { options: { includeImages?, includeMetadata?, includeDsoOverrides? }, ids? }
app.post('/api/export', (req, res) => {
  try {
    const body = req.body as {
      mode?: string;
      options?: {
        includeImages?: boolean;
        includeMetadata?: boolean;
        includeDsoOverrides?: boolean;
        includeCustomGear?: boolean;
        includeSetups?: boolean;
        includePlans?: boolean;
        includeShortcuts?: boolean;
        includePoiCategories?: boolean;
        includeSkyRegions?: boolean;
      };
      ids?: string[];
      // Keyboard-shortcut bindings live in the client's localStorage; the client sends
      // them here so they can be bundled into the backup ZIP as shortcuts.json.
      shortcuts?: unknown;
    };

    // Support legacy mode='metadata' for backward compat with backup button
    const legacyMetadataOnly = body.mode === 'metadata';
    const options = body.options ?? {};
    const includeImages = legacyMetadataOnly ? false : options.includeImages !== false;
    const includeMetadata = options.includeMetadata !== false;
    const includeDsoOverrides = options.includeDsoOverrides === true;
    const includeCustomGear = options.includeCustomGear === true;
    const includeSetups = options.includeSetups === true;
    const includePlans = options.includePlans === true;
    const includeShortcuts = options.includeShortcuts === true;
    const includePoiCategories = options.includePoiCategories === true;
    const includeSkyRegions = options.includeSkyRegions === true;

    const { ids } = body;
    const allPhotos = getAllPhotos();
    const selected =
      Array.isArray(ids) && ids.length > 0
        ? allPhotos.filter((p) => ids.includes(p.id))
        : allPhotos;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '-');

    if (legacyMetadataOnly) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.json"`);
      res.json(selected);
      return;
    }

    // Always produce a ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => {
      console.error('[Export] archiver error:', err);
    });
    archive.pipe(res);

    if (includeMetadata) {
      const manifest = { manifestVersion: 1, photos: selected };
      archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' });
    }
    if (includeImages) {
      for (const photo of selected) {
        const filePath = path.join(UPLOADS_DIR, photo.filename);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: `images/${photo.filename}` });
        }
        if (photo.thumbFilename) {
          const thumbPath = path.join(UPLOADS_DIR, photo.thumbFilename);
          if (fs.existsSync(thumbPath)) {
            archive.file(thumbPath, { name: `images/${photo.thumbFilename}` });
          }
        }
      }
    }
    if (includeDsoOverrides) {
      const overrides = getAllDsoOverrides();
      archive.append(Buffer.from(JSON.stringify(overrides, null, 2)), {
        name: 'dso-overrides.json',
      });
    }
    if (includeCustomGear) {
      const customGear = getAllCustomGear().map((g) => ({
        id: g.id,
        type: g.type,
        ...JSON.parse(g.data),
      }));
      archive.append(Buffer.from(JSON.stringify(customGear, null, 2)), {
        name: 'custom-gear.json',
      });
    }
    if (includeSetups) {
      const setups = getAllGearSetups().map((r) => ({
        id: r.id,
        name: r.name,
        telescopeId: r.telescope_id,
        cameraId: r.camera_id,
        accessoryId: r.accessory_id,
        enabled: r.enabled === 1,
      }));
      archive.append(Buffer.from(JSON.stringify(setups, null, 2)), { name: 'gear-setups.json' });
    }
    if (includePoiCategories) {
      const cats = getAllPoiCategories().map(poiCategoryToApi);
      archive.append(Buffer.from(JSON.stringify(cats, null, 2)), { name: 'poi-categories.json' });
    }
    if (includeSkyRegions) {
      const regions = getAllSkyRegions().map(skyRegionToApi);
      archive.append(Buffer.from(JSON.stringify(regions, null, 2)), {
        name: 'sky-regions.json',
      });
    }
    if (includePlans) {
      const entriesByPlan = new Map<string, PlanEntryRow[]>();
      for (const e of getAllPlanEntries()) {
        const list = entriesByPlan.get(e.plan_id) ?? [];
        list.push(e);
        entriesByPlan.set(e.plan_id, list);
      }
      const mosaicsByPlan = new Map<string, PlanMosaicRow[]>();
      for (const m of getAllPlanMosaics()) {
        const list = mosaicsByPlan.get(m.plan_id) ?? [];
        list.push(m);
        mosaicsByPlan.set(m.plan_id, list);
      }
      const plans = getPlans().map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nightOf: p.night_of ?? null,
        setupId: p.setup_id ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        sortBy: p.sort_by ?? 'transit',
        // planEntryToApi carries mosaicId/mosaicWDeg/mosaicHDeg so tiles re-group on import.
        entries: (entriesByPlan.get(p.id) ?? []).map(planEntryToApi),
        mosaics: (mosaicsByPlan.get(p.id) ?? []).map(planMosaicToApi),
      }));
      archive.append(Buffer.from(JSON.stringify(plans, null, 2)), { name: 'plans.json' });
    }
    if (includeShortcuts && body.shortcuts && typeof body.shortcuts === 'object') {
      archive.append(Buffer.from(JSON.stringify(body.shortcuts, null, 2)), {
        name: 'shortcuts.json',
      });
    }

    archive.finalize();
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/import/preview:
 *   post:
 *     summary: Preview import bundle without writing data
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Import preview returned successfully
 */
// Import preview (dry-run) — inspect ZIP contents and report what can be imported
app.post('/api/import/preview', uploadBundle.single('bundle'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      const zipDir = await unzipper.Open.buffer(file.buffer);
      const inspect = await inspectZipContents(zipDir.files as any);

      const filenameToOriginalName = new Map(
        inspect.photos.map((p) => [p.filename, p.originalName]),
      );
      const originalNames = inspect.photos.map((p) => p.originalName).filter(Boolean);
      const existingSet = new Set(
        originalNames.length > 0
          ? checkPhotosExistByName(originalNames).map((r) => r.originalName)
          : [],
      );

      const images = inspect.imageEntries.map((entry) => ({
        filename: entry.filename,
        originalName: filenameToOriginalName.get(entry.filename) ?? entry.filename,
        size: entry.size,
        exists: existingSet.has(filenameToOriginalName.get(entry.filename) ?? ''),
      }));

      // Keyboard shortcuts are localStorage-only, so they aren't imported server-side:
      // we return the parsed bundle and the client applies it to localStorage.
      let hasShortcuts = false;
      let shortcuts: unknown;
      const shortcutsEntry = zipDir.files.find((f) => f.path === 'shortcuts.json');
      if (shortcutsEntry) {
        try {
          const parsed = JSON.parse((await shortcutsEntry.buffer()).toString('utf8'));
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            hasShortcuts = true;
            shortcuts = parsed;
          }
        } catch {
          /* ignore invalid shortcuts.json */
        }
      }

      // Resolve name-based conflicts: a plan/setup/gear whose name already exists
      // will be replaced (not duplicated) if the user selects it for import.
      const existingPlanNames = new Set(getPlans().map((p) => p.name));
      const existingSetupNames = new Set(getAllGearSetups().map((s) => s.name));
      const existingGearKeys = new Set(
        getAllCustomGear().map((g) => {
          let name = g.id;
          try {
            const d = JSON.parse(g.data);
            if (typeof d?.name === 'string') name = d.name;
          } catch {
            /* ignore */
          }
          return `${g.type}\u001f${name}`;
        }),
      );

      const plans = inspect.planItems.map((p) => ({ ...p, exists: existingPlanNames.has(p.name) }));
      const setups = inspect.setupItems.map((s) => ({
        ...s,
        exists: existingSetupNames.has(s.name),
      }));
      const gear = inspect.gearItems.map((g) => ({
        ...g,
        exists: existingGearKeys.has(`${g.type}\u001f${g.name}`),
      }));

      res.json(
        buildZipPreviewResponse(inspect, { hasShortcuts, shortcuts, images, plans, setups, gear }),
      );
    } else if (ext === '.json') {
      const photos = JSON.parse(file.buffer.toString('utf8'));
      if (!Array.isArray(photos)) {
        res.status(400).json({ error: 'Format de manifeste invalide' });
        return;
      }
      res.json({
        hasMetadata: photos.length > 0,
        photos: photos.length,
        hasDsoOverrides: false,
        hasCustomGear: false,
        hasSetups: false,
        hasPoiCategories: false,
        hasSkyRegions: false,
        hasPlans: false,
        hasShortcuts: false,
        images: [],
        plans: [],
        setups: [],
        gear: [],
      });
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * @swagger
 * /api/import:
 *   post:
 *     summary: Import photos and optional DSO overrides from a bundle
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Import completed successfully
 */
// Import photos from ZIP (full) or JSON (metadata only)
// Form fields: bundle (file), importMetadata, importDsoOverrides, selectedImages,
//              selectedPlans, selectedSetups, selectedGear (all JSON string[])
app.post('/api/import', uploadBundle.single('bundle'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    const importMetadata = req.body?.importMetadata === '1';
    const importDsoOverrides = req.body?.importDsoOverrides === '1';
    const importPoiCategories = req.body?.importPoiCategories === '1';
    const importSkyRegions = req.body?.importSkyRegions === '1';
    // null means "no image filter" (metadata-only import); a Set means "import only these filenames"
    const selectedImages: Set<string> | null = req.body?.selectedImages
      ? new Set(JSON.parse(req.body.selectedImages) as string[])
      : null;
    // Plans / setups / custom gear are now selected per item by id. An absent field
    // means "import none of that category"; a Set means "import only these ids".
    const parseIdSet = (raw: unknown): Set<string> =>
      typeof raw === 'string' ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
    const selectedPlans = parseIdSet(req.body?.selectedPlans);
    const selectedSetups = parseIdSet(req.body?.selectedSetups);
    const selectedGear = parseIdSet(req.body?.selectedGear);

    const ext = path.extname(file.originalname).toLowerCase();
    let photos: any[] = [];
    let dsoOverridesImported = 0;
    // Tracks which image basenames were successfully written to UPLOADS_DIR.
    // null means no image extraction happened (JSON import), so don't filter by it.
    let writtenFiles: Set<string> | null = null;

    if (ext === '.zip') {
      const zipDir = await unzipper.Open.buffer(file.buffer);

      // Security: validate all entry paths before extraction
      for (const entry of zipDir.files) {
        if (!isValidZipEntryPath(entry.path)) {
          res.status(400).json({ error: `Chemin invalide dans le ZIP : ${entry.path}` });
          return;
        }
      }

      const manifestEntry = zipDir.files.find((f) => f.path === 'manifest.json');
      const dsoOverridesEntry = zipDir.files.find((f) => f.path === 'dso-overrides.json');
      const customGearEntry = zipDir.files.find((f) => f.path === 'custom-gear.json');
      const gearSetupsEntry = zipDir.files.find((f) => f.path === 'gear-setups.json');
      const poiCategoriesEntry = zipDir.files.find((f) => f.path === 'poi-categories.json');
      const skyRegionsEntry = zipDir.files.find((f) => f.path === 'sky-regions.json');
      const plansEntry = zipDir.files.find((f) => f.path === 'plans.json');

      if (
        !manifestEntry &&
        !dsoOverridesEntry &&
        !customGearEntry &&
        !gearSetupsEntry &&
        !poiCategoriesEntry &&
        !skyRegionsEntry &&
        !plansEntry
      ) {
        res.status(400).json({ error: 'Aucun contenu reconnu dans le ZIP' });
        return;
      }

      if (manifestEntry) {
        const content = await manifestEntry.buffer();
        photos = parseManifestPhotos(JSON.parse(content.toString('utf8')));
      }

      // Import DSO overrides
      if (dsoOverridesEntry && importDsoOverrides) {
        try {
          const dsoOverrides = JSON.parse((await dsoOverridesEntry.buffer()).toString('utf8'));
          if (typeof dsoOverrides === 'object' && !Array.isArray(dsoOverrides)) {
            for (const [id, data] of Object.entries(dsoOverrides)) {
              if (
                typeof id === 'string' &&
                id.length <= 100 &&
                typeof data === 'object' &&
                data !== null &&
                !Array.isArray(data)
              ) {
                upsertDsoOverrideDB(id, data as object);
                dsoOverridesImported++;
              }
            }
          }
        } catch {
          /* ignore invalid dso-overrides.json */
        }
      }

      // Import custom gear (only the ids the user selected). Name-based override:
      // existing gear of the same type + name is deleted before the imported one is
      // written, so a re-imported item replaces rather than duplicates.
      if (customGearEntry && selectedGear.size > 0) {
        try {
          const rawGear = JSON.parse((await customGearEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawGear)) {
            // Snapshot existing gear once, before importing, so name-based replacement
            // targets only pre-import rows — two same-type+name items within this bundle
            // must not delete each other.
            const existingGear = getAllCustomGear().map((r) => {
              let n = r.id;
              try {
                const d = JSON.parse(r.data);
                if (typeof d?.name === 'string') n = d.name;
              } catch {
                /* ignore */
              }
              return { id: r.id, type: r.type, name: n };
            });
            for (const g of rawGear) {
              if (
                typeof g.id === 'string' &&
                selectedGear.has(g.id) &&
                ['telescope', 'camera', 'accessory'].includes(g.type)
              ) {
                const { id, type, ...data } = g;
                const name = typeof data.name === 'string' ? data.name : id;
                const sameType = existingGear.filter((r) => r.type === type);
                idsToReplaceByName(sameType, name).forEach(deleteCustomGearDB);
                upsertCustomGearDB(id, type as 'telescope' | 'camera' | 'accessory' | 'filter', {
                  ...data,
                  id,
                });
              }
            }
          }
        } catch {
          /* ignore invalid custom-gear.json */
        }
      }

      // Import gear setups (only the ids the user selected). Name-based override:
      // an existing setup with the same name is deleted before the imported one is
      // written, so a re-imported setup replaces rather than duplicates.
      if (gearSetupsEntry && selectedSetups.size > 0) {
        try {
          const rawSetups = JSON.parse((await gearSetupsEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawSetups)) {
            // Snapshot once (so same-name siblings in this bundle don't delete each
            // other) and only replace by name when the name is non-empty — an empty
            // name must not match, and delete, every existing unnamed setup. Same-id
            // re-imports are still handled by upsertGearSetup.
            const existingSetups = getAllGearSetups();
            for (const s of rawSetups) {
              if (
                typeof s.id === 'string' &&
                selectedSetups.has(s.id) &&
                typeof s.telescopeId === 'string' &&
                typeof s.cameraId === 'string'
              ) {
                const name = typeof s.name === 'string' ? s.name : '';
                if (name) idsToReplaceByName(existingSetups, name).forEach(deleteGearSetup);
                upsertGearSetup({
                  id: s.id,
                  name: typeof s.name === 'string' ? s.name : '',
                  telescope_id: s.telescopeId,
                  camera_id: s.cameraId,
                  accessory_id: typeof s.accessoryId === 'string' ? s.accessoryId : null,
                  enabled: s.enabled === false ? 0 : 1,
                });
              }
            }
          }
        } catch {
          /* ignore invalid gear-setups.json */
        }
      }

      // Import POI categories (id-based upsert: a re-imported category with the same
      // id replaces the existing one, keeping any photos' POI references valid).
      if (poiCategoriesEntry && importPoiCategories) {
        try {
          const rawCats = JSON.parse((await poiCategoriesEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawCats)) {
            rawCats.forEach((c, ci) => {
              if (typeof c?.id !== 'string' || typeof c?.name !== 'string') return;
              upsertPoiCategory({
                id: c.id,
                name: c.name,
                color: typeof c.color === 'string' && c.color.trim() ? c.color : '#888888',
                position: Number.isFinite(c.position) ? Number(c.position) : ci,
              });
            });
          }
        } catch {
          /* ignore invalid poi-categories.json */
        }
      }

      // Import sky regions (id-based upsert: a re-imported region with the same id
      // replaces the existing one).
      if (skyRegionsEntry && importSkyRegions) {
        try {
          const rawRegions = JSON.parse((await skyRegionsEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawRegions)) {
            rawRegions.forEach((r, ri) => {
              if (
                typeof r?.id !== 'string' ||
                typeof r?.name !== 'string' ||
                !Array.isArray(r.points)
              ) {
                return;
              }
              upsertSkyRegion({
                id: r.id,
                name: r.name,
                color: typeof r.color === 'string' && r.color.trim() ? r.color : '#4ea1ff',
                points: JSON.stringify(r.points),
                position: Number.isFinite(r.position) ? Number(r.position) : ri,
              });
            });
          }
        } catch {
          /* ignore invalid sky-regions.json */
        }
      }

      // Import night plans (only the ids the user selected). Name-based override:
      // an existing plan with the same name is deleted (with its entries) before the
      // imported one is recreated, so a re-imported plan replaces rather than
      // duplicates. The bundle's id is kept so its entry/mosaic/setup refs resolve;
      // we also delete any same-id row to avoid a primary-key collision on recreate.
      if (plansEntry && selectedPlans.size > 0) {
        try {
          const rawPlans = JSON.parse((await plansEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawPlans)) {
            // Snapshot once so two same-name plans in this bundle don't delete each
            // other; replace by name only when non-empty. Same-id collisions are
            // handled by the explicit deletePlan(p.id) below.
            const existingPlans = getPlans();
            rawPlans.forEach((p, pi) => {
              if (typeof p.id !== 'string' || typeof p.name !== 'string') return;
              if (!selectedPlans.has(p.id)) return;
              if (p.name) idsToReplaceByName(existingPlans, p.name).forEach(deletePlan);
              deletePlan(p.id);
              createPlan({
                id: p.id,
                name: p.name,
                position: typeof p.position === 'number' ? p.position : pi,
                created_at: new Date().toISOString(),
                night_of: typeof p.nightOf === 'string' ? p.nightOf : null,
                setup_id: typeof p.setupId === 'string' ? p.setupId : null,
                lat: typeof p.lat === 'number' ? p.lat : null,
                lon: typeof p.lon === 'number' ? p.lon : null,
                sort_by: PLAN_SORT_KEYS.includes(p.sortBy) ? p.sortBy : 'transit',
              });
              if (Array.isArray(p.entries)) {
                p.entries.forEach((e: any, ei: number) => {
                  if (typeof e.id !== 'string') return;
                  const hasDso = typeof e.dsoId === 'string';
                  const hasCoords = typeof e.ra === 'number' && typeof e.dec === 'number';
                  // An entry needs either a DSO target or explicit frame coords.
                  if (!hasDso && !hasCoords) return;
                  addPlanEntry({
                    id: e.id,
                    plan_id: p.id,
                    dso_id: hasDso ? e.dsoId : null,
                    position: typeof e.position === 'number' ? e.position : ei,
                    pa_deg: typeof e.paDeg === 'number' ? e.paDeg : null,
                    ra: hasCoords ? e.ra : null,
                    dec: hasCoords ? e.dec : null,
                    notes: typeof e.notes === 'string' ? e.notes : null,
                    // Keep the tile→mosaic grouping (the mosaic row is recreated below).
                    mosaic_id: typeof e.mosaicId === 'string' ? e.mosaicId : null,
                    mosaic_w_deg: typeof e.mosaicWDeg === 'number' ? e.mosaicWDeg : null,
                    mosaic_h_deg: typeof e.mosaicHDeg === 'number' ? e.mosaicHDeg : null,
                    observation_windows: sanitizeObservationWindows(e.observationWindows),
                  });
                });
              }
              if (Array.isArray(p.mosaics)) {
                p.mosaics.forEach((m: any, mi: number) => {
                  if (typeof m.id !== 'string') return;
                  if (typeof m.centerRa !== 'number' || typeof m.centerDec !== 'number') return;
                  addPlanMosaic({
                    id: m.id,
                    plan_id: p.id,
                    dso_id: typeof m.dsoId === 'string' ? m.dsoId : null,
                    name: typeof m.name === 'string' ? m.name : null,
                    center_ra: m.centerRa,
                    center_dec: m.centerDec,
                    pa_deg: typeof m.paDeg === 'number' ? m.paDeg : 0,
                    overlap_pct: typeof m.overlapPct === 'number' ? m.overlapPct : 20,
                    cols: Number.isInteger(m.cols) ? m.cols : 1,
                    rows: Number.isInteger(m.rows) ? m.rows : 1,
                    position: typeof m.position === 'number' ? m.position : mi,
                  });
                });
              }
            });
          }
        } catch {
          /* ignore invalid plans.json */
        }
      }

      // Flush libvips handle cache before writing to avoid Windows sharing violations
      // when re-importing the same files that sharp processed in a previous request.
      sharp.cache(false);

      // Extract selected image files to UPLOADS_DIR (always overwrite)
      const imageEntries = zipDir.files.filter(
        (f) => f.path.startsWith('images/') && f.type === 'File',
      );
      writtenFiles = new Set<string>();
      for (const entry of imageEntries) {
        const baseName = path.basename(entry.path);
        const ext2 = path.extname(baseName).toLowerCase();
        if (!ALLOWED_PHOTO_EXTENSIONS.has(ext2)) continue;
        if (selectedImages !== null && !selectedImages.has(baseName)) continue;
        const destPath = path.join(UPLOADS_DIR, baseName);
        try {
          const buf = await entry.buffer();
          await fs.promises.writeFile(destPath, buf);
          writtenFiles.add(baseName);
        } catch (writeErr) {
          console.warn(`[Import] Failed to write ${baseName}:`, writeErr);
        }
      }
    } else if (ext === '.json') {
      photos = JSON.parse(file.buffer.toString('utf8'));
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }

    if (!Array.isArray(photos)) {
      res.status(400).json({ error: 'Format de manifeste invalide' });
      return;
    }

    let imported = 0;
    let skipped = 0;

    if (importMetadata && photos.length > 0) {
      const allNames = photos.map((p: any) => p.originalName ?? p.filename ?? p.id).filter(Boolean);
      const existingByName = new Map(
        checkPhotosExistByName(allNames).map((r) => [r.originalName, r.id]),
      );

      for (const p of photos) {
        if (!p.id || typeof p.id !== 'string') {
          skipped++;
          continue;
        }
        const origName: string = p.originalName ?? p.filename ?? p.id;

        // Skip photos whose image file was not written (not selected, or write failed)
        if (writtenFiles !== null && !writtenFiles.has(p.filename)) {
          skipped++;
          continue;
        }

        const existingId = existingByName.get(origName);
        if (existingId) deletePhoto(existingId);

        const corrs = Array.isArray(p.correspondences) ? p.correspondences : [];
        const thumbFilename =
          typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null;
        const result = createPhotoWithId(
          p.id,
          p.filename ?? `${p.id}.jpg`,
          origName,
          p.width ?? 0,
          p.height ?? 0,
          corrs,
          p.createdAt ?? null,
          p.manualPlacement ? JSON.stringify(p.manualPlacement) : null,
          Array.isArray(p.dsoIds) ? p.dsoIds : [],
          Array.isArray(p.labels) ? p.labels : [],
          typeof p.notes === 'string' ? p.notes : '',
          'skip',
          sanitizeIntegrationRows(p.integrations),
          thumbFilename,
          typeof p.observationDate === 'string' ? p.observationDate : null,
          sanitizePois(p.pointsOfInterest),
          sanitizeCaptureDetails(p.captureDetails),
          typeof p.gearSetupId === 'string' ? p.gearSetupId : null,
        );
        if (result === 'imported') imported++;
        else skipped++;
      }
    }

    // Regenerate any missing thumbnails
    const THUMB_SIZE = 400;
    const photosToThumb = importMetadata
      ? photos.filter((p: any) => writtenFiles === null || writtenFiles.has(p.filename))
      : [];
    for (const p of photosToThumb) {
      if (!p.id || typeof p.id !== 'string') continue;
      const filename: string = p.filename ?? `${p.id}.jpg`;
      const thumbFilename: string = p.thumbFilename ?? filename.replace(/(\.[^.]+)$/, '_thumb.jpg');
      const fullPath = path.join(UPLOADS_DIR, filename);
      const thumbPath = path.join(UPLOADS_DIR, thumbFilename);
      if (fs.existsSync(fullPath) && !fs.existsSync(thumbPath)) {
        try {
          const meta = await sharp(fullPath).metadata();
          const w = meta.width ?? 0;
          const h = meta.height ?? 0;
          const scale = Math.min(1, THUMB_SIZE / Math.max(w, h, 1));
          await sharp(fullPath)
            .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
            .jpeg({ quality: 75 })
            .toFile(thumbPath);
        } catch (thumbErr) {
          console.warn(`[Import] Thumbnail regeneration failed for ${filename}:`, thumbErr);
        }
      }
    }

    res.json({ imported, skipped, dsoOverridesImported });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * @swagger
 * /api/solve-wcs:
 *   post:
 *     summary: Solve WCS from FITS/TIFF companion files
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Correspondences returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 correspondences:
 *                   type: array
 *                 sourceWidth:
 *                   type: number
 *                 sourceHeight:
 *                   type: number
 *                 dateObs:
 *                   type: string
 *                   description: DATE-OBS header value (UTC ISO 8601), present when available
 *                 expTime:
 *                   type: number
 *                   description: EXPTIME header value in seconds, present when available
 *                 stackCnt:
 *                   type: integer
 *                   description: STACKCNT header value (frame count), present when available
 *                 filter:
 *                   type: string
 *                   description: FILTER header value, present when available
 *                 captureDetails:
 *                   type: object
 *                   description: Parsed capture fields (gain, offset, iso, ccdTemp, setTemp, binning) keyed by field id, present when available
 *       400:
 *         description: Missing file, unsupported format, or no WCS data found
 *       500:
 *         description: Server error
 */
// --- WCS solve route ---
app.post('/api/solve-wcs', uploadWCS.single('photo'), async (req, res) => {
  try {
    // Get language from request (default to 'en')
    const lang = (
      req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
    ) as ServerLang;

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: msg.api.noFile(lang), code: 'NO_FILE' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_WCS_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedWcsFormat(lang),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    const wcs = extractWCS(file.buffer, ext);
    if (!wcs) {
      res.json({ success: false, error: msg.api.noWcsData(lang), code: 'NO_WCS_DATA' });
      return;
    }

    // Get image dimensions from NAXIS header keywords
    let imageWidth = wcs.NAXIS1;
    let imageHeight = wcs.NAXIS2;

    // For TIFF, try to get dimensions from sharp if NAXIS not in header
    if ((ext === '.tif' || ext === '.tiff') && (!imageWidth || !imageHeight)) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        imageWidth = metadata.width || imageWidth;
        imageHeight = metadata.height || imageHeight;
      } catch {
        // Ignore sharp errors
      }
    }

    if (!imageWidth || !imageHeight) {
      res.json({
        success: false,
        error: msg.api.noImageDimensions(lang),
        code: 'NO_IMAGE_DIMENSIONS',
      });
      return;
    }

    loadServerCatalog();
    // Standard FITS files from PixInsight/Siril use FITS Y convention (Y=1 = bottom row,
    // Y increases upward), which is opposite to display/screen convention (Y=0 = top row).
    // Pass fitsYConvention=true so pixel positions are correctly flipped when mapping
    // catalog stars into the image's display coordinate space.
    const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight, true);

    if (correspondences.length < 3) {
      res.json({
        success: false,
        error: msg.api.notEnoughCatalogStars(lang),
        code: 'NOT_ENOUGH_CATALOG_STARS',
      });
      return;
    }

    // Rescale correspondences to target (display image) dimensions if provided
    const targetWidth = parseInt(req.body.targetWidth || '0', 10);
    const targetHeight = parseInt(req.body.targetHeight || '0', 10);

    let finalCorrespondences = correspondences;
    let dimensionWarning:
      | {
          sourceW: number;
          sourceH: number;
          targetW: number;
          targetH: number;
          aspectMismatch: boolean;
        }
      | undefined;

    if (
      targetWidth > 0 &&
      targetHeight > 0 &&
      (targetWidth !== imageWidth || targetHeight !== imageHeight)
    ) {
      const sourceAspect = imageWidth / imageHeight;
      const targetAspect = targetWidth / targetHeight;
      const aspectDiff = Math.abs(sourceAspect - targetAspect) / sourceAspect;
      const aspectMismatch = aspectDiff > 0.01; // >1% aspect ratio difference

      dimensionWarning = {
        sourceW: imageWidth,
        sourceH: imageHeight,
        targetW: targetWidth,
        targetH: targetHeight,
        aspectMismatch,
      };

      const scaleX = targetWidth / imageWidth;
      const scaleY = targetHeight / imageHeight;
      finalCorrespondences = correspondences.map((c) => ({
        ...c,
        photoX: c.photoX * scaleX,
        photoY: c.photoY * scaleY,
      }));
      console.log(
        `[WCS] Rescaled correspondences: source ${imageWidth}x${imageHeight} → target ${targetWidth}x${targetHeight} (aspectMismatch=${aspectMismatch})`,
      );
    }

    res.json({
      success: true,
      correspondences: finalCorrespondences,
      sourceWidth: imageWidth,
      sourceHeight: imageHeight,
      ...(dimensionWarning ? { dimensionWarning } : {}),
      ...(wcs.dateObs ? { dateObs: wcs.dateObs } : {}),
      ...(wcs.expTime !== undefined ? { expTime: wcs.expTime } : {}),
      ...(wcs.stackCnt !== undefined ? { stackCnt: wcs.stackCnt } : {}),
      ...(wcs.filter ? { filter: wcs.filter } : {}),
      ...(wcs.captureDetails ? { captureDetails: wcs.captureDetails } : {}),
    });
  } catch (err: any) {
    console.error('WCS solve error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @swagger
 * /api/photos/convert:
 *   post:
 *     summary: Convert a raw astro image (TIFF/FITS) to a PNG, plus any WCS/capture metadata
 *     description: >
 *       The raw file is never stored. It is decoded server-side with a faithful linear
 *       mapping (no histogram stretch) into an 8-bit PNG, returned to the caller alongside
 *       any WCS-derived star correspondences and capture metadata found in its FITS header
 *       — in the same shape as `/api/solve-wcs` — so a plate-solved raw file can be placed
 *       on the sky map without running a solver.
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Converted successfully (success:false in the body means no WCS was found — not an error; the PNG is still returned)
 *       400:
 *         description: Missing file or unsupported/corrupt raw format
 *       500:
 *         description: Server error
 */
app.post('/api/photos/convert', uploadRaw.single('photo'), async (req, res) => {
  try {
    const lang = (
      req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
    ) as ServerLang;

    if (!isElectron) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(ip + ':upload', UPLOAD_LIMIT)) {
        res
          .status(429)
          .json({ error: "Trop d'uploads, réessayez dans un instant", code: 'UPLOAD_RATE_LIMIT' });
        return;
      }
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: msg.api.noFile(lang), code: 'NO_FILE' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_WCS_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedRawFormat(lang, ext),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    let decoded: Awaited<ReturnType<typeof decodeRawAstroImage>>;
    try {
      decoded = await decodeRawAstroImage(file.buffer, ext);
    } catch (err) {
      if (
        err instanceof UnsupportedRawFormatError ||
        err instanceof UnsupportedTiffError ||
        err instanceof UnsupportedFitsError
      ) {
        logServerError('raw_convert_unsupported', err, { ext });
        res.status(400).json({
          success: false,
          error: msg.api.rawDecodeFailed(lang, err.message),
          code: 'UNSUPPORTED_RAW_FORMAT',
        });
        return;
      }
      throw err;
    }

    // WCS + capture metadata, exactly like /api/solve-wcs — no rescale is ever needed
    // here since the PNG has the raw file's own exact dimensions.
    const wcs = extractWCS(file.buffer, ext);
    let success = false;
    let correspondences: ReturnType<typeof wcsToCorrespondences> = [];
    if (wcs) {
      loadServerCatalog();
      correspondences = wcsToCorrespondences(wcs, decoded.width, decoded.height, true);
      success = correspondences.length >= 3;
    }

    res.json({
      success,
      ...(success ? { correspondences } : { error: msg.api.noWcsData(lang), code: 'NO_WCS_DATA' }),
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      width: decoded.width,
      height: decoded.height,
      pngBase64: decoded.png.toString('base64'),
      ...(wcs?.dateObs ? { dateObs: wcs.dateObs } : {}),
      ...(wcs?.expTime !== undefined ? { expTime: wcs.expTime } : {}),
      ...(wcs?.stackCnt !== undefined ? { stackCnt: wcs.stackCnt } : {}),
      ...(wcs?.filter ? { filter: wcs.filter } : {}),
      ...(wcs?.captureDetails ? { captureDetails: wcs.captureDetails } : {}),
    });
  } catch (err: any) {
    logServerError('raw_convert_failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @swagger
 * /api/solve-astap:
 *   post:
 *     summary: Submit ASTAP plate solve job
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       202:
 *         description: Job accepted, poll GET /api/solve-astap/:jobId for result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                   description: Job ID for polling
 *       400:
 *         description: Invalid request (missing file, unsupported format, bad dimensions)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
// --- ASTAP local plate solve route ---
app.post('/api/solve-astap', upload.single('photo'), async (req, res) => {
  const lang = (
    req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
  ) as ServerLang;

  if (!req.file) {
    res
      .status(400)
      .json({ error: lang === 'fr' ? 'Fichier manquant' : 'Missing file', code: 'MISSING_FILE' });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedFormatAstap(lang, ext),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    const meta = await sharp(req.file.buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      res.status(400).json({
        success: false,
        error: msg.api.cannotDetermineImageDimensions(lang),
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      return;
    }

    const hints: { ra?: number; dec?: number; fov?: number; radius?: number } = {};
    if (req.body.ra !== undefined) hints.ra = parseFloat(req.body.ra);
    if (req.body.dec !== undefined) hints.dec = parseFloat(req.body.dec);
    if (req.body.fov !== undefined) hints.fov = parseFloat(req.body.fov);
    if (req.body.radius !== undefined) hints.radius = parseFloat(req.body.radius);

    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname;
    const orientation = meta.orientation;
    const job = createJob();
    res.status(202).json({ jobId: job.id });

    void (async () => {
      updateJob(job.id, { status: 'running' });
      try {
        const result = await solveWithASTAP(
          fileBuffer,
          ext,
          width,
          height,
          Object.keys(hints).length > 0 ? hints : undefined,
          lang,
          job.abortController.signal,
          originalName,
        );
        if (job.abortController.signal.aborted) {
          updateJob(job.id, { status: 'canceled' });
          return;
        }
        if (result.success && result.correspondences && orientation && orientation !== 1) {
          result.correspondences = result.correspondences.map((c) => {
            const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, orientation);
            return { ...c, photoX: x, photoY: y };
          });
        }
        updateJob(job.id, {
          status: result.success ? 'success' : 'failed',
          result,
          error: result.error,
        });
      } catch (err: any) {
        if (err?.code === 'SOLVE_CANCELED') {
          updateJob(job.id, { status: 'canceled' });
        } else {
          console.error('[SolveASTAP] Background solve error:', err);
          updateJob(job.id, { status: 'failed', error: err.message || 'Unknown ASTAP error' });
        }
      }
    })();
  } catch (err: any) {
    console.error('[SolveASTAP] Request handling error:', err);
    if (!res.writableEnded) res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-astap/{jobId}:
 *   get:
 *     summary: Get ASTAP solve job status and result
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID returned from POST /api/solve-astap
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, running, success, failed, canceled]
 *                 result:
 *                   type: object
 *                   description: Plate solve result (present when status is success or failed)
 *                 error:
 *                   type: string
 *                   description: Error message when status is failed
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [JOB_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.get('/api/solve-astap/:jobId', (req, res) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
      return;
    }
    res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
  } catch (err) {
    console.error('[SolveASTAP] Failed to get job status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-astap/{jobId}:
 *   delete:
 *     summary: Cancel an in-progress ASTAP solve job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID returned from POST /api/solve-astap
 *     responses:
 *       200:
 *         description: Job canceled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [JOB_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.delete('/api/solve-astap/:jobId', (req, res) => {
  try {
    const ok = cancelJob(req.params.jobId);
    if (!ok) {
      res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[SolveASTAP] Failed to cancel job:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-field:
 *   post:
 *     summary: Submit solve-field plate solve job
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       202:
 *         description: Job accepted, poll GET /api/solve-field/:jobId for result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                   description: Job ID for polling
 *       400:
 *         description: Invalid request (missing file, unsupported format, bad dimensions)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
// --- solve-field local plate solve route ---
app.post('/api/solve-field', upload.single('photo'), async (req, res) => {
  const lang = (
    req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
  ) as ServerLang;

  if (!req.file) {
    res.status(400).json({ error: msg.api.missingFile(lang), code: 'MISSING_FILE' });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedFormatSolveField(lang, ext),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    const meta = await sharp(req.file.buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      res.status(400).json({
        success: false,
        error: msg.api.cannotDetermineImageDimensions(lang),
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      return;
    }

    const hints: { ra?: number; dec?: number; fov?: number; radius?: number } = {};
    if (req.body.ra !== undefined) hints.ra = parseFloat(req.body.ra);
    if (req.body.dec !== undefined) hints.dec = parseFloat(req.body.dec);
    if (req.body.fov !== undefined) hints.fov = parseFloat(req.body.fov);
    if (req.body.radius !== undefined) hints.radius = parseFloat(req.body.radius);

    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname;
    const orientation = meta.orientation;
    const job = createJob();
    res.status(202).json({ jobId: job.id });

    void (async () => {
      updateJob(job.id, { status: 'running' });
      try {
        const result = await solveWithSolveField(
          fileBuffer,
          ext,
          width,
          height,
          Object.keys(hints).length > 0 ? hints : undefined,
          lang,
          job.abortController.signal,
          originalName,
        );
        if (job.abortController.signal.aborted) {
          updateJob(job.id, { status: 'canceled' });
          return;
        }
        if (result.success && result.correspondences && orientation && orientation !== 1) {
          result.correspondences = result.correspondences.map((c) => {
            const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, orientation);
            return { ...c, photoX: x, photoY: y };
          });
        }
        updateJob(job.id, {
          status: result.success ? 'success' : 'failed',
          result,
          error: result.error,
        });
      } catch (err: any) {
        if (err?.code === 'SOLVE_CANCELED') {
          updateJob(job.id, { status: 'canceled' });
        } else {
          console.error('[SolveField] Background solve error:', err);
          updateJob(job.id, {
            status: 'failed',
            error: err.message || 'Unknown solve-field error',
          });
        }
      }
    })();
  } catch (err: any) {
    console.error('[SolveField] Request handling error:', err);
    if (!res.writableEnded) res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-field/{jobId}:
 *   get:
 *     summary: Get solve-field job status and result
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID returned from POST /api/solve-field
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, running, success, failed, canceled]
 *                 result:
 *                   type: object
 *                   description: Plate solve result (present when status is success or failed)
 *                 error:
 *                   type: string
 *                   description: Error message when status is failed
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [JOB_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.get('/api/solve-field/:jobId', (req, res) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
      return;
    }
    res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
  } catch (err) {
    console.error('[SolveField] Failed to get job status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-field/{jobId}:
 *   delete:
 *     summary: Cancel an in-progress solve-field job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID returned from POST /api/solve-field
 *     responses:
 *       200:
 *         description: Job canceled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 code:
 *                   type: string
 *                   enum: [JOB_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.delete('/api/solve-field/:jobId', (req, res) => {
  try {
    const ok = cancelJob(req.params.jobId);
    if (!ok) {
      res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[SolveField] Failed to cancel job:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/solve-plate:
 *   post:
 *     summary: Submit a photo to Astrometry.net for plate solving
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Plate solve job submitted successfully
 */
// --- Astrometry.net plate solve routes ---
app.post('/api/solve-plate', upload.single('photo'), async (req, res) => {
  try {
    // Get language from request (default to 'en')
    const lang = req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en';

    if (!isAstrometryConfigured()) {
      res.status(400).json({
        error:
          lang === 'fr'
            ? 'ASTROMETRY_API_KEY non configurée sur le serveur'
            : 'ASTROMETRY_API_KEY not configured on server',
        code: 'ASTROMETRY_NOT_CONFIGURED',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({
        error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided',
        code: 'NO_FILE',
      });
      return;
    }

    // Get image dimensions for calibration conversion later
    let imageWidth = 0;
    let imageHeight = 0;
    try {
      const metadata = await sharp(file.buffer).metadata();
      imageWidth = metadata.width || 0;
      imageHeight = metadata.height || 0;
    } catch {
      // For non-image formats, try to extract from FITS header
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.fits' || ext === '.fit') {
        const wcs = extractWCS(file.buffer, ext);
        if (wcs) {
          imageWidth = wcs.NAXIS1;
          imageHeight = wcs.NAXIS2;
        }
      }
    }

    if (!imageWidth || !imageHeight) {
      res.status(400).json({
        error:
          lang === 'fr'
            ? "Impossible de déterminer les dimensions de l'image"
            : 'Cannot determine image dimensions',
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      return;
    }

    // Parse optional hints from request body
    const hints: {
      ra?: number;
      dec?: number;
      radius?: number;
      scale_lower?: number;
      scale_upper?: number;
    } = {};
    if (req.body.ra !== undefined) hints.ra = parseFloat(req.body.ra);
    if (req.body.dec !== undefined) hints.dec = parseFloat(req.body.dec);
    if (req.body.radius !== undefined) hints.radius = parseFloat(req.body.radius);
    if (req.body.scale_lower !== undefined) hints.scale_lower = parseFloat(req.body.scale_lower);
    if (req.body.scale_upper !== undefined) hints.scale_upper = parseFloat(req.body.scale_upper);

    const jobId = await submitJob(
      file.buffer,
      file.originalname,
      imageWidth,
      imageHeight,
      Object.keys(hints).length > 0 ? hints : undefined,
    );
    res.json({ jobId });
  } catch (err: any) {
    console.error('Plate solve submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/solve-plate/{id}:
 *   get:
 *     summary: Get Astrometry.net job status and correspondences
 *     description: Retrieve the status and plate solving results for a submitted Astrometry.net job
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The job ID returned from /api/solve-plate POST submission
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, succeeded, failed]
 *                 correspondences:
 *                   type: array
 *                   description: Star correspondences if solve succeeded
 *                 error:
 *                   type: string
 *                   description: Error message if solve failed
 *                 dsoIds:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Job introuvable"
 *                 code:
 *                   type: string
 *                   enum: [JOB_NOT_FOUND]
 *       500:
 *         description: Server error
 */
app.get('/api/solve-plate/:id', (req, res) => {
  const job = getJobStatus(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job introuvable', code: 'JOB_NOT_FOUND' });
    return;
  }

  res.json({
    jobId: job.localId,
    status: job.status,
    correspondences: job.correspondences,
    error: job.error,
    dsoIds: job.dsoIds,
  });
});

/**
 * @swagger
 * /api/astrometry/submissions:
 *   get:
 *     summary: List user's Astrometry.net submissions
 *     responses:
 *       200:
 *         description: Submissions returned successfully
 */
// --- List user's astrometry.net submissions ---
app.get('/api/astrometry/submissions', async (req, res) => {
  try {
    if (!isAstrometryConfigured()) {
      res
        .status(400)
        .json({ error: 'ASTROMETRY_API_KEY not configured', code: 'ASTROMETRY_NOT_CONFIGURED' });
      return;
    }

    const submissions = await listUserSubmissions();
    res.json({ submissions });
  } catch (err: any) {
    console.error('List submissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/astrometry/reuse:
 *   post:
 *     summary: Reuse an existing Astrometry.net submission for a new photo
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Submission reused successfully
 */
// --- Reuse existing astrometry.net submission ---
app.post('/api/astrometry/reuse', upload.single('photo'), async (req, res) => {
  try {
    const lang = req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en';

    if (!isAstrometryConfigured()) {
      res.status(400).json({
        error:
          lang === 'fr' ? 'ASTROMETRY_API_KEY non configurée' : 'ASTROMETRY_API_KEY not configured',
        code: 'ASTROMETRY_NOT_CONFIGURED',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({
        error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided',
        code: 'NO_FILE',
      });
      return;
    }

    const jobId = parseInt(req.body.jobId, 10);
    if (!jobId || isNaN(jobId)) {
      res.status(400).json({
        error: lang === 'fr' ? 'Job ID invalide' : 'Invalid job ID',
        code: 'INVALID_JOB_ID',
      });
      return;
    }

    // Get image dimensions
    let imageWidth = 0;
    let imageHeight = 0;
    try {
      const metadata = await sharp(file.buffer).metadata();
      imageWidth = metadata.width || 0;
      imageHeight = metadata.height || 0;
    } catch {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.fits' || ext === '.fit') {
        const wcs = extractWCS(file.buffer, ext);
        if (wcs) {
          imageWidth = wcs.NAXIS1;
          imageHeight = wcs.NAXIS2;
        }
      }
    }

    if (!imageWidth || !imageHeight) {
      res.status(400).json({
        error:
          lang === 'fr'
            ? 'Impossible de déterminer les dimensions'
            : 'Cannot determine image dimensions',
        code: 'CANNOT_DETERMINE_DIMENSIONS',
      });
      return;
    }

    const result = await reuseSubmission(jobId, imageWidth, imageHeight);

    if (result.success) {
      res.json({ success: true, correspondences: result.correspondences });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (err: any) {
    console.error('Reuse submission error:', err);
    res.status(500).json({ error: err.message });
  }
});

// createApp is async so swagger routes are always registered before the SPA catch-all,
// guaranteeing correct ordering regardless of dist/ presence. It does not listen: the
// entry point (server/index.ts) does.
export async function createApp(): Promise<express.Express> {
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
