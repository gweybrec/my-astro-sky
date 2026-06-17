import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPhoto, getAllPhotos, deletePhoto, getPhotoFilename, updatePhotoManualPlacement, updatePhotoMetadata, updatePhotoDrawOrder, createPhotoWithId, checkPhotosExist, checkPhotosExistByName, getSetting, setSetting, deleteSetting, getAllDsoOverrides, upsertDsoOverride as upsertDsoOverrideDB, deleteDsoOverride as deleteDsoOverrideDB, getAllCustomGear, upsertCustomGear as upsertCustomGearDB, deleteCustomGear as deleteCustomGearDB, deleteAllPhotoMetadata as deleteAllPhotoMetadataDB, deleteAllDsoOverrides as deleteAllDsoOverridesDB, deleteAllCustomGear as deleteAllCustomGearDB, getAllGearSetups, upsertGearSetup, updateGearSetupEnabled, deleteGearSetup, deleteAllGearSetups, getPlans, getPlan, getAllPlanEntries, createPlan, renamePlan, updatePlanSettings, deletePlan, reorderPlans, planEntryExists, addPlanEntry, nextPlanEntryPosition, removePlanEntry, reorderPlanEntries, updatePlanEntryFrame, type PlanEntryRow } from './db.js';
import { ZipArchive } from 'archiver';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const unzipper = _require('unzipper') as typeof import('unzipper');
import { isValidZipEntryPath, parseManifestPhotos, validateDsoOverrideCoords, inspectZipContents } from './import-utils.js';
import { extractWCS, wcsToCorrespondences, loadServerCatalog } from './wcs-reader.js';
import { submitJob, getJobStatus, isConfigured as isAstrometryConfigured, listUserSubmissions, reuseSubmission, resetSession as resetAstrometrySession } from './astrometry.js';
import { solveWithASTAP } from './astap.js';
import { solveWithSolveField } from './solve-field.js';
import { createJob, getJob, updateJob, cancelJob } from './solve-queue.js';
import { searchDeepStars, getDeepStarByHip, searchStarsByPosition } from './star-search.js';
import { msg } from './messages.js';
import type { ServerLang } from './messages.js';
import { logServerError } from './logger.js';
import { probeAstap, probeSolveField, probeDataDir } from './probe-utils.js';
import { parseLatestRelease, type LatestRelease } from './github-release.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const RESOURCES_DIR = process.env.RESOURCES_DIR || path.join(__dirname, '..', 'resources');

// Built-in gear catalogs — loaded once at startup
const builtInTelescopes: object[] = JSON.parse(fs.readFileSync(path.join(RESOURCES_DIR, 'telescopes.json'), 'utf-8'));
const builtInCameras: object[]    = JSON.parse(fs.readFileSync(path.join(RESOURCES_DIR, 'cameras.json'), 'utf-8'));
const builtInAccessories: object[] = JSON.parse(fs.readFileSync(path.join(RESOURCES_DIR, 'accessories.json'), 'utf-8'));

const byBrandModel = (a: any, b: any) =>
  `${a.brand ?? ''} ${a.model ?? ''}`.localeCompare(`${b.brand ?? ''} ${b.model ?? ''}`);
const ALLOWED_PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_WCS_EXTENSIONS = new Set(['.tif', '.tiff', '.fits', '.fit']);
const MAX_CORRESPONDENCES = 100;

interface IntegrationRow {
  frames: number;
  seconds: number;
  filter: string;
}

function sanitizeIntegrationRows(input: unknown): IntegrationRow[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry: any) => ({
    frames: Number.isInteger(Number(entry?.frames)) && Number(entry?.frames) >= 1 ? Number(entry.frames) : 0,
    seconds: Number.isInteger(Number(entry?.seconds)) && Number(entry?.seconds) >= 1 ? Number(entry.seconds) : 0,
    filter: typeof entry?.filter === 'string' ? entry.filter.trim() : '',
  }));
}

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

// In Electron the server runs inside the Electron main process (process.versions.electron is set).
// Rate limiting is meaningless there (single-user local app).
const isElectron = !!process.versions.electron;

// Simple in-memory rate limiter
const rateLimits = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const UPLOAD_LIMIT = 200;  // uploads per minute
const API_LIMIT = 300;    // API requests per minute — sized for batch status polling (every 2s per active solve)

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  let timestamps = rateLimits.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateLimits.set(ip, timestamps);
  }
  // Evict old entries
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();

// Set TRUST_PROXY=1 when running behind a reverse proxy (nginx, Caddy) so Express
// reads the real client IP from X-Forwarded-For. Not needed in Electron (localhost only).
if (!isElectron && (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true')) {
  app.set('trust proxy', 1);
}

const enableSwagger = process.env.NODE_ENV !== 'production' && process.env.ENABLE_SWAGGER !== 'false';

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
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/tiff',
  'image/gif', 'image/webp', 'image/bmp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Invalid file type'), { status: 400, code: 'INVALID_FILE_TYPE' }));
    }
  },
});

// Separate multer instance for WCS companion files (FITS/TIFF can be large)
const uploadWCS = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB for raw FITS/TIFF
});

// Separate multer instance for import bundles (ZIP/JSON — not image MIME types)
const uploadBundle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// In production, serve the built frontend
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  // Long cache for hashed assets and catalog data, no cache for index.html
  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), {
    etag: true,
    lastModified: true,
  }));
  app.use('/data', express.static(path.join(DIST_DIR, 'data'), {
    etag: true,
    lastModified: true,
    // maxAge defaults to 0, which means "always revalidate"
  }));
  app.use(express.static(DIST_DIR, { maxAge: 0 }));
}

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// Rate limiting on /api routes — skipped in Electron (single-user local app)
app.use('/api', (req, res, next) => {
  if (isElectron) { next(); return; }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip, API_LIMIT)) {
    res.status(429).json({ error: 'Trop de requêtes, réessayez dans un instant', code: 'RATE_LIMIT' });
    return;
  }
  next();
});

/**
 * @swagger
 * /api/photos:
 *   post:
 *     summary: Upload a photo with star correspondences
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Photo uploaded and saved successfully
 */
// Upload a photo with 3 star correspondences
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!isElectron) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(ip + ':upload', UPLOAD_LIMIT)) {
        res.status(429).json({ error: 'Trop d\'uploads, réessayez dans un instant', code: 'UPLOAD_RATE_LIMIT' });
        return;
      }
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni', code: 'NO_FILE' });
      return;
    }

    // Validate file extension
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_PHOTO_EXTENSIONS.has(fileExt)) {
      res.status(400).json({ error: `Extension non autorisée : ${fileExt}`, code: 'INVALID_EXTENSION' });
      return;
    }

    const corrJson = req.body?.correspondences;
    if (!corrJson) {
      res.status(400).json({ error: 'Correspondances manquantes', code: 'MISSING_CORRESPONDENCES' });
      return;
    }

    let correspondences: any[];
    try {
      correspondences = JSON.parse(corrJson);
    } catch {
      res.status(400).json({ error: 'JSON des correspondances invalide', code: 'INVALID_JSON' });
      return;
    }
    if (!Array.isArray(correspondences) || correspondences.length < 2) {
      res.status(400).json({ error: 'Au moins 2 correspondances requises', code: 'MIN_CORRESPONDENCES' });
      return;
    }
    if (correspondences.length > MAX_CORRESPONDENCES) {
      res.status(400).json({ error: `Trop de correspondances (max ${MAX_CORRESPONDENCES})`, code: 'MAX_CORRESPONDENCES' });
      return;
    }

    // Validate each correspondence field
    for (const c of correspondences) {
      if (!Number.isInteger(c.pointIndex) || c.pointIndex < 0) {
        res.status(400).json({ error: 'pointIndex invalide (entier >= 0 attendu)', code: 'INVALID_POINT_INDEX' });
        return;
      }
      if (typeof c.photoX !== 'number' || !Number.isFinite(c.photoX) || c.photoX < 0) {
        res.status(400).json({ error: 'photoX invalide (nombre positif attendu)', code: 'INVALID_PHOTO_X' });
        return;
      }
      if (typeof c.photoY !== 'number' || !Number.isFinite(c.photoY) || c.photoY < 0) {
        res.status(400).json({ error: 'photoY invalide (nombre positif attendu)', code: 'INVALID_PHOTO_Y' });
        return;
      }
      // starHip=0 is allowed when starRa/starDec are provided (direct RA/Dec input)
      if (c.starHip === 0) {
        if (typeof c.starRa !== 'number' || !Number.isFinite(c.starRa) ||
            typeof c.starDec !== 'number' || !Number.isFinite(c.starDec)) {
          res.status(400).json({ error: 'starRa/starDec requis quand starHip=0', code: 'INVALID_STAR_HIP' });
          return;
        }
      } else if (!Number.isInteger(c.starHip) || c.starHip <= 0) {
        res.status(400).json({ error: 'starHip invalide (entier positif attendu)', code: 'INVALID_STAR_HIP' });
        return;
      }
    }

    // Get original dimensions — Sharp throws for non-image or corrupt files
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      metadata = await sharp(file.buffer).metadata();
    } catch {
      res.status(400).json({ error: 'Fichier image invalide ou corrompu', code: 'INVALID_IMAGE' });
      return;
    }
    const origWidth = metadata.width!;
    const origHeight = metadata.height!;

    console.log('[Upload] File pixel dimensions:', origWidth, 'x', origHeight);
    console.log('[Upload] EXIF orientation:', metadata.orientation);

    // Browser shows images with EXIF rotation applied, so naturalWidth/Height reflect rotated dimensions
    // Orientations 5, 6, 7, 8 involve 90° rotation which swaps width and height
    const needsSwap = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
    const browserWidth = needsSwap ? origHeight : origWidth;
    const browserHeight = needsSwap ? origWidth : origHeight;
    
    console.log('[Upload] Browser showed dimensions:', browserWidth, 'x', browserHeight);

    // Apply EXIF rotation to bake orientation into file (keeps coordinate space consistent)
    const resized = sharp(file.buffer).rotate();
    const newWidth = browserWidth;
    const newHeight = browserHeight;

    // Save to disk
    const id = uuidv4();
    const filename = `${id}${fileExt || '.jpg'}`;
    try {
      await resized.toFile(path.join(UPLOADS_DIR, filename));
    } catch {
      res.status(400).json({ error: 'Impossible de traiter l\'image (format non supporté ou fichier corrompu)', code: 'INVALID_IMAGE' });
      return;
    }

    console.log('[Upload] Scaling correspondences from browser', browserWidth, 'x', browserHeight, 'to final', newWidth, 'x', newHeight);

    // Scale correspondences from browser dimensions to final dimensions
    const scaleX = newWidth / browserWidth;
    const scaleY = newHeight / browserHeight;

    const scaledCorrespondences = correspondences.map((c: any) => ({
      pointIndex: c.pointIndex,
      photoX: c.photoX * scaleX,
      photoY: c.photoY * scaleY,
      starHip: c.starHip,
      starName: c.starName || '',
      starRa: c.starRa ?? null,
      starDec: c.starDec ?? null,
    }));

    // Handle manual placement if provided
    let scaledManualPlacement: string | null = null;
    if (req.body?.manualPlacement) {
      try {
        const placement = JSON.parse(req.body.manualPlacement);
        //Scale projPerPx from browser dimensions to final dimensions
        // Browser used browserWidth x browserHeight, we scale to newWidth x newHeight
        const avgScale = (scaleX + scaleY) / 2;
        const scaledPlacement = {
          ...placement,
          projPerPx: placement.projPerPx / avgScale,
        };
        console.log('[Upload] Scaling projPerPx from', placement.projPerPx, 'by 1/', avgScale.toFixed(4), '=', scaledPlacement.projPerPx);
        scaledManualPlacement = JSON.stringify(scaledPlacement);
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Parse photo metadata fields
    let dsoIds: string[] = [];
    let labels: string[] = [];
    let integrations: IntegrationRow[] = [];
    let notes = '';
    try { dsoIds = JSON.parse(req.body?.dsoIds || '[]'); if (!Array.isArray(dsoIds)) dsoIds = []; } catch { dsoIds = []; }
    try { labels = JSON.parse(req.body?.labels || '[]'); if (!Array.isArray(labels)) labels = []; } catch { labels = []; }
    try {
      integrations = sanitizeIntegrationRows(JSON.parse(req.body?.integrations || '[]'));
    } catch {
      integrations = [];
    }
    if (typeof req.body?.notes === 'string') notes = req.body.notes.slice(0, 5000);
    let observationDate: string | null = null;
    if (typeof req.body?.observationDate === 'string' && req.body.observationDate.trim()) {
      observationDate = req.body.observationDate.trim().slice(0, 50);
    }

    // Allow caller to override the display name
    const displayName = typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim().slice(0, 255)
      : file.originalname;

    // Generate low-res thumbnail (400px on longest side, JPEG q75)
    const THUMB_SIZE = 400;
    const thumbFilename = `${id}_thumb.jpg`;
    try {
      const thumbScale = Math.min(1, THUMB_SIZE / Math.max(newWidth, newHeight));
      const thumbW = Math.max(1, Math.round(newWidth * thumbScale));
      const thumbH = Math.max(1, Math.round(newHeight * thumbScale));
      await sharp(path.join(UPLOADS_DIR, filename)).resize(thumbW, thumbH).jpeg({ quality: 75 }).toFile(path.join(UPLOADS_DIR, thumbFilename));
    } catch (thumbErr) {
      console.warn('[Upload] Thumbnail generation failed:', thumbErr);
    }

    // Store in database
    createPhoto(id, filename, displayName, newWidth, newHeight, scaledCorrespondences, scaledManualPlacement, dsoIds, labels, notes, integrations, thumbFilename, observationDate);

    res.json({
      id,
      filename,
      originalName: displayName,
      width: newWidth,
      height: newHeight,
      createdAt: new Date().toISOString(),
      correspondences: scaledCorrespondences,
      dsoIds,
      labels,
      integrations,
      notes,
      thumbFilename,
      ...(scaledManualPlacement ? { manualPlacement: JSON.parse(scaledManualPlacement) } : {}),
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GitHub repository that publishes releases, used by the in-app update check.
const GITHUB_RELEASES_REPO = 'gweybrec/my-astro-sky';
const LATEST_RELEASE_TTL_MS = 60 * 60 * 1000; // 1 hour

let latestReleaseCache: { value: LatestRelease | null; fetchedAt: number } | null = null;

/**
 * @swagger
 * /api/version/latest:
 *   get:
 *     summary: Get the latest published GitHub release
 *     description: >
 *       Proxies the latest release of the project's GitHub repository, cached for one hour.
 *       Returns null on any upstream failure so the in-app update check fails silently.
 *     responses:
 *       200:
 *         description: Latest release info, or null when unavailable
 *         content:
 *           application/json:
 *             schema:
 *               nullable: true
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   description: Release tag name (e.g. v0.2.0)
 *                   example: v0.2.0
 *                 url:
 *                   type: string
 *                   description: GitHub release page URL
 *                 publishedAt:
 *                   type: string
 *                   nullable: true
 *                   description: ISO 8601 publication timestamp
 */
app.get('/api/version/latest', async (_req, res) => {
  const now = Date.now();
  if (latestReleaseCache && now - latestReleaseCache.fetchedAt < LATEST_RELEASE_TTL_MS) {
    res.json(latestReleaseCache.value);
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MyAstroSky' } },
    );
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    const value = parseLatestRelease(await response.json());
    latestReleaseCache = { value, fetchedAt: now };
    res.json(value);
  } catch (err) {
    // Network error, rate limit, or no releases yet: fail silently with null so
    // the update check never disrupts startup. Being offline is an expected
    // condition, so warn rather than error. Cache the null briefly to avoid
    // hammering GitHub when offline.
    console.warn('[VersionCheck] Could not fetch latest release', err);
    latestReleaseCache = { value: null, fetchedAt: now };
    res.json(null);
  }
});

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get frontend configuration values
 *     responses:
 *       200:
 *         description: Configuration returned successfully
 */
// Frontend configuration
app.get('/api/config', (_req, res) => {
  const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
  // Extract just the filename from the path for the frontend URL
  const catalogFile = path.basename(catalogPath);
  res.json({
    starCatalog: `/data/${catalogFile}`,
  });
});

// User-configurable solver / API settings
const EDITABLE_STRING_SETTINGS = ['ASTAP_PATH', 'SOLVE_FIELD_PATH', 'ASTROMETRY_DATA_DIR', 'MAX_PARALLEL_SOLVES'] as const;
const EDITABLE_BOOLEAN_SETTINGS = ['USE_WSL_FOR_SOLVE_FIELD', 'USE_WSL_FOR_ASTAP'] as const;

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get current API and solver settings
 *     responses:
 *       200:
 *         description: Settings returned successfully
 */
app.get('/api/settings', (_req, res) => {
  const result: Record<string, string | boolean> = {
    apiKeySet: !!getSetting('ASTROMETRY_API_KEY'),
    isWindows: process.platform === 'win32',
  };
  for (const key of EDITABLE_STRING_SETTINGS) {
    result[key] = getSetting(key) ?? '';
  }
  for (const key of EDITABLE_BOOLEAN_SETTINGS) {
    const value = (getSetting(key) ?? '').trim().toLowerCase();
    result[key] = value === '1' || value === 'true' || value === 'yes' || value === 'on';
  }
  res.json(result);
});

/**
 * @swagger
 * /api/settings:
 *   put:
 *     summary: Update solver and API settings
 *     responses:
 *       200:
 *         description: Settings updated successfully
 */
app.put('/api/settings', (req, res) => {
  const body = req.body as Record<string, unknown>;

  // API key: only update when the user provides a non-empty value
  if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
    if (process.env.ASTROMETRY_API_KEY !== undefined) {
      res.status(409).json({
        error: 'ASTROMETRY_API_KEY is managed via environment variable and cannot be changed here',
        code: 'SETTING_LOCKED_BY_ENV',
        key: 'ASTROMETRY_API_KEY',
      });
      return;
    }
    setSetting('ASTROMETRY_API_KEY', body.apiKey.trim());
    resetAstrometrySession(); // invalidate cached session for the old key
  }

  for (const key of EDITABLE_STRING_SETTINGS) {
    if (typeof body[key] === 'string') {
      setSetting(key, (body[key] as string).trim());
    }
  }

  for (const key of EDITABLE_BOOLEAN_SETTINGS) {
    if (typeof body[key] === 'boolean') {
      setSetting(key, body[key] ? '1' : '0');
    }
  }

  res.json({ ok: true });
});

/**
 * @swagger
 * /api/settings/astrometry-api-key:
 *   delete:
 *     summary: Delete stored Astrometry API key
 *     responses:
 *       200:
 *         description: API key deleted successfully
 */
app.delete('/api/settings/astrometry-api-key', (_req, res) => {
  if (process.env.ASTROMETRY_API_KEY !== undefined) {
    res.status(409).json({
      error: 'ASTROMETRY_API_KEY is managed via environment variable and cannot be changed here',
      code: 'SETTING_LOCKED_BY_ENV',
      key: 'ASTROMETRY_API_KEY',
    });
    return;
  }

  deleteSetting('ASTROMETRY_API_KEY');
  resetAstrometrySession();
  res.json({ ok: true });
});

const execFileAsync = promisify(execFile);

/**
 * @swagger
 * /api/settings/probe-astap:
 *   post:
 *     summary: Probe astap_cli binary (run without args, check exit code)
 *     responses:
 *       200:
 *         description: Probe result returned
 */
app.post('/api/settings/probe-astap', async (req, res) => {
  const { path: binPath = '', useWSL = false } = req.body as { path?: string; useWSL?: boolean };
  const result = await probeAstap(binPath, !!useWSL, execFileAsync as any);
  res.json(result);
});

/**
 * @swagger
 * /api/settings/probe-solve-field:
 *   post:
 *     summary: Probe solve-field binary (run --version, check exit code)
 *     responses:
 *       200:
 *         description: Probe result returned
 */
app.post('/api/settings/probe-solve-field', async (req, res) => {
  const { path: binPath = '', useWSL = false } = req.body as { path?: string; useWSL?: boolean };
  const result = await probeSolveField(binPath, !!useWSL, execFileAsync as any);
  res.json(result);
});

/**
 * @swagger
 * /api/settings/probe-data-dir:
 *   post:
 *     summary: Probe astrometry index directory (list contents)
 *     responses:
 *       200:
 *         description: Probe result returned
 */
app.post('/api/settings/probe-data-dir', async (req, res) => {
  const { dir = '', useWSL = false } = req.body as { dir?: string; useWSL?: boolean };
  const result = await probeDataDir(dir, !!useWSL, process.platform, execFileAsync as any);
  res.json(result);
});

/**
 * @swagger
 * /api/photos:
 *   get:
 *     summary: List all uploaded photos
 *     responses:
 *       200:
 *         description: Photo list returned successfully
 */
// List all photos (includes fileSize from disk for export size estimation)
app.get('/api/photos', (_req, res) => {
  try {
    const photos = getAllPhotos();
    const photosWithSize = photos.map(p => {
      const filePath = path.join(UPLOADS_DIR, p.filename);
      let fileSize: number | null = null;
      try { fileSize = fs.statSync(filePath).size; } catch { /* file missing */ }
      return { ...p, fileSize };
    });
    res.json(photosWithSize);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/photos/order:
 *   patch:
 *     summary: Persist photo draw order
 *     responses:
 *       200:
 *         description: Photo order persisted successfully
 */
// Persist photo draw order (array order = bottom to top stack order)
app.patch('/api/photos/order', (req, res) => {
  try {
    const { photoIds } = req.body as { photoIds?: unknown };

    if (!Array.isArray(photoIds) || photoIds.some(id => typeof id !== 'string' || id.length === 0)) {
      res.status(400).json({ error: 'photoIds must be a non-empty array of strings', code: 'INVALID_PHOTO_ORDER' });
      return;
    }

    const unique = new Set(photoIds);
    if (unique.size !== photoIds.length) {
      res.status(400).json({ error: 'photoIds contains duplicates', code: 'INVALID_PHOTO_ORDER' });
      return;
    }

    const allPhotos = getAllPhotos();
    const allIds = new Set(allPhotos.map(p => p.id));
    if (photoIds.length !== allIds.size || photoIds.some(id => !allIds.has(id))) {
      res.status(400).json({ error: 'photoIds must include all existing photos exactly once', code: 'INVALID_PHOTO_ORDER' });
      return;
    }

    const ok = updatePhotoDrawOrder(photoIds);
    if (!ok && photoIds.length > 0) {
      res.status(500).json({ error: 'Failed to persist photo order', code: 'PHOTO_ORDER_UPDATE_FAILED' });
      return;
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides:
 *   get:
 *     summary: Get all DSO overrides
 *     responses:
 *       200:
 *         description: DSO override list returned successfully
 */
// ─── DSO user overrides ──────────────────────────────────────────────────────

app.get('/api/dso-overrides', (_req, res) => {
  try {
    res.json(getAllDsoOverrides());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides/{id}:
 *   put:
 *     summary: Create or update a DSO override
 *     description: Create or update metadata overrides for a DSO (name, type, coordinates)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: DSO catalog identifier (e.g. "M1", "NGC253", "SH2-15")
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Override properties (name_fr, name_en, type, ra, dec, etc.)
 *     responses:
 *       200:
 *         description: DSO override saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid DSO id or override data
 *       500:
 *         description: Server error
 */
app.put('/api/dso-overrides/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.length > 100) {
      res.status(400).json({ error: 'Invalid DSO id' });
      return;
    }
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'Invalid override data' });
      return;
    }
    const coordError = validateDsoOverrideCoords(data as Record<string, unknown>);
    if (coordError) {
      res.status(400).json(coordError);
      return;
    }
    upsertDsoOverrideDB(id, data);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides/{id}:
 *   delete:
 *     summary: Delete a DSO override
 *     description: Remove metadata overrides for a DSO, reverting to default catalog data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: DSO catalog identifier (e.g. "M1", "NGC253", "SH2-15")
 *     responses:
 *       200:
 *         description: DSO override deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Server error
 */
app.delete('/api/dso-overrides/:id', (req, res) => {
  try {
    deleteDsoOverrideDB(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/dso-overrides:
 *   delete:
 *     summary: Delete all DSO overrides
 *     description: Removes all user-defined DSO metadata overrides from the database, reverting all DSOs to default catalog data.
 *     responses:
 *       200:
 *         description: All DSO overrides deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: number
 *       500:
 *         description: Server error
 */
app.delete('/api/dso-overrides', (_req, res) => {
  try {
    const deleted = deleteAllDsoOverridesDB();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] DSO overrides delete failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Gear catalogs ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/telescopes:
 *   get:
 *     summary: List all telescopes (built-in + custom)
 *     description: Returns the full telescope catalog merged with any user-created custom telescopes.
 *     responses:
 *       200:
 *         description: Telescope list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
app.get('/api/telescopes', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter(g => g.type === 'telescope')
      .map(g => JSON.parse(g.data));
    res.json([...builtInTelescopes, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/cameras:
 *   get:
 *     summary: List all cameras (built-in + custom)
 *     description: Returns the full camera catalog merged with any user-created custom cameras.
 *     responses:
 *       200:
 *         description: Camera list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
app.get('/api/cameras', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter(g => g.type === 'camera')
      .map(g => JSON.parse(g.data));
    res.json([...builtInCameras, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/accessories:
 *   get:
 *     summary: List all optical accessories (built-in + custom)
 *     description: Returns the full accessory catalog merged with any user-created custom accessories.
 *     responses:
 *       200:
 *         description: Accessory list returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
app.get('/api/accessories', (_req, res) => {
  try {
    const custom = getAllCustomGear()
      .filter(g => g.type === 'accessory')
      .map(g => JSON.parse(g.data));
    res.json([...builtInAccessories, ...custom].sort(byBrandModel));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/custom-gear:
 *   post:
 *     summary: Create a custom telescope, camera, or accessory
 *     description: Saves a user-defined equipment item to the database. The item becomes available in the corresponding dropdown immediately.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - data
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [telescope, camera, accessory]
 *                 description: Equipment category
 *               data:
 *                 type: object
 *                 description: Equipment fields matching the category schema (brand, model, and math-required fields are mandatory)
 *     responses:
 *       200:
 *         description: Custom gear item created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: custom-3f2504e0-4f89-11d3-9a0c-0305e82c3301
 *       400:
 *         description: Missing or invalid type or data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 */
app.post('/api/custom-gear', (req, res) => {
  try {
    const { type, data } = req.body as { type?: string; data?: object };
    if (!type || !['telescope', 'camera', 'accessory'].includes(type)) {
      res.status(400).json({ error: 'Invalid type — must be telescope, camera, or accessory' });
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'Invalid data — must be a non-null object' });
      return;
    }
    const id = `custom-${uuidv4()}`;
    upsertCustomGearDB(id, type as 'telescope' | 'camera' | 'accessory', { ...data, id });
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/custom-gear/{id}:
 *   delete:
 *     summary: Delete a custom gear item
 *     description: Permanently removes a user-created equipment item. Built-in catalog items cannot be deleted via this endpoint.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom gear item id (must start with "custom-")
 *     responses:
 *       200:
 *         description: Custom gear item deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Attempt to delete a built-in (non-custom) item
 *       404:
 *         description: Custom gear item not found
 *       500:
 *         description: Server error
 */
app.delete('/api/custom-gear/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id.startsWith('custom-')) {
      res.status(400).json({ error: 'Only custom gear items can be deleted' });
      return;
    }
    const deleted = deleteCustomGearDB(id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/custom-gear:
 *   delete:
 *     summary: Delete all custom gear
 *     description: Removes all user-created custom gear items (telescopes, cameras, accessories) from the database. Built-in catalog items are unaffected.
 *     responses:
 *       200:
 *         description: All custom gear deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: number
 *       500:
 *         description: Server error
 */
app.delete('/api/custom-gear', (_req, res) => {
  try {
    const deleted = deleteAllCustomGearDB();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] Custom gear delete failed', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Gear setups ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/gear-setups:
 *   get:
 *     summary: Get all named gear setups
 *     responses:
 *       200:
 *         description: Array of gear setups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   telescopeId: { type: string }
 *                   cameraId: { type: string }
 *                   accessoryId: { type: string, nullable: true }
 *                   enabled: { type: boolean }
 *       500:
 *         description: Server error
 */
app.get('/api/gear-setups', (_req, res) => {
  try {
    const rows = getAllGearSetups();
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      telescopeId: r.telescope_id,
      cameraId: r.camera_id,
      accessoryId: r.accessory_id ?? null,
      enabled: r.enabled === 1,
    })));
  } catch (err: any) {
    console.error('[GearSetups] Failed to list setups', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/gear-setups:
 *   post:
 *     summary: Create a new named gear setup
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, telescopeId, cameraId]
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-provided setup name
 *               telescopeId:
 *                 type: string
 *               cameraId:
 *                 type: string
 *               accessoryId:
 *                 type: string
 *                 nullable: true
 *               enabled:
 *                 type: boolean
 *                 description: Whether the FOV frame is drawn on the sky map (defaults to true)
 *     responses:
 *       200:
 *         description: Setup created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string }
 *       500:
 *         description: Server error
 */
app.post('/api/gear-setups', (req, res) => {
  try {
    const { name, telescopeId, cameraId, accessoryId, enabled } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required', code: 'MISSING_NAME' }); return;
    }
    if (!telescopeId || typeof telescopeId !== 'string') {
      res.status(400).json({ error: 'telescopeId is required', code: 'MISSING_TELESCOPE' }); return;
    }
    if (!cameraId || typeof cameraId !== 'string') {
      res.status(400).json({ error: 'cameraId is required', code: 'MISSING_CAMERA' }); return;
    }
    const id = `setup-${uuidv4()}`;
    upsertGearSetup({
      id, name: name.trim(), telescope_id: telescopeId, camera_id: cameraId,
      accessory_id: accessoryId ?? null, enabled: enabled !== false ? 1 : 0,
    });
    res.json({ id });
  } catch (err: any) {
    console.error('[GearSetups] Failed to create setup', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}:
 *   put:
 *     summary: Update a named gear setup (full replace)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, telescopeId, cameraId]
 *             properties:
 *               name: { type: string }
 *               telescopeId: { type: string }
 *               cameraId: { type: string }
 *               accessoryId: { type: string, nullable: true }
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Setup updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.put('/api/gear-setups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, telescopeId, cameraId, accessoryId, enabled } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || !telescopeId || !cameraId) {
      res.status(400).json({ error: 'name, telescopeId, and cameraId are required' }); return;
    }
    upsertGearSetup({
      id, name: name.trim(), telescope_id: telescopeId, camera_id: cameraId,
      accessory_id: accessoryId ?? null, enabled: enabled !== false ? 1 : 0,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to update setup', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}/enabled:
 *   patch:
 *     summary: Toggle enabled state of a gear setup
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Enabled state updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: enabled must be boolean
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Setup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.patch('/api/gear-setups/:id/enabled', (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body as any;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' }); return;
    }
    const ok = updateGearSetupEnabled(id, enabled);
    if (!ok) { res.status(404).json({ error: 'Setup not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to update enabled state', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/gear-setups/{id}:
 *   delete:
 *     summary: Delete a named gear setup
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Setup ID
 *     responses:
 *       200:
 *         description: Setup deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Setup not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.delete('/api/gear-setups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const ok = deleteGearSetup(id);
    if (!ok) { res.status(404).json({ error: 'Setup not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[GearSetups] Failed to delete setup', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/gear-setups:
 *   delete:
 *     summary: Delete all gear setups
 *     responses:
 *       200:
 *         description: All setups deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 deleted: { type: number }
 *       500:
 *         description: Server error
 */
app.delete('/api/gear-setups', (_req, res) => {
  try {
    const deleted = deleteAllGearSetups();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[GearSetups] Failed to delete all setups', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Night plans ──────────────────────────────────────────────────────────────

function planEntryToApi(e: PlanEntryRow) {
  return {
    id: e.id, dsoId: e.dso_id ?? null, position: e.position, paDeg: e.pa_deg ?? null,
    ra: e.ra ?? null, dec: e.dec ?? null, notes: e.notes ?? null,
  };
}

/**
 * @swagger
 * /api/plans:
 *   get:
 *     summary: Get all night plans with their entries
 *     responses:
 *       200:
 *         description: Array of plans, each with nested entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   position: { type: integer }
 *                   entries:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         dsoId: { type: string }
 *                         position: { type: integer }
 *                         paDeg: { type: number, nullable: true }
 *                         notes: { type: string, nullable: true }
 *       500:
 *         description: Server error
 */
app.get('/api/plans', (_req, res) => {
  try {
    const entries = getAllPlanEntries();
    const byPlan = new Map<string, PlanEntryRow[]>();
    for (const e of entries) {
      const list = byPlan.get(e.plan_id) ?? [];
      list.push(e);
      byPlan.set(e.plan_id, list);
    }
    res.json(getPlans().map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      nightOf: p.night_of ?? null,
      setupId: p.setup_id ?? null,
      entries: (byPlan.get(p.id) ?? []).map(planEntryToApi),
    })));
  } catch (err: any) {
    console.error('[Plans] Failed to list plans', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans:
 *   post:
 *     summary: Create a new night plan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name for the plan
 *     responses:
 *       200:
 *         description: Plan created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.post('/api/plans', (req, res) => {
  try {
    const { name } = req.body as any;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    const id = `plan-${uuidv4()}`;
    const position = getPlans().length;
    createPlan({ id, name: name.trim(), position, created_at: new Date().toISOString(), night_of: null, setup_id: null });
    res.json({ id });
  } catch (err: any) {
    console.error('[Plans] Failed to create plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/order:
 *   put:
 *     summary: Reorder all plans
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: Plan IDs in the desired order
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: ids must be an array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.put('/api/plans/order', (req, res) => {
  try {
    const { ids } = req.body as any;
    if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids must be an array' }); return; }
    reorderPlans(ids);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to reorder plans', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}:
 *   put:
 *     summary: Rename a night plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Plan renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: Missing name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.put('/api/plans/:id', (req, res) => {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as any;
    const hasName = 'name' in body;
    const hasSettings = 'nightOf' in body || 'setupId' in body;
    if (!hasName && !hasSettings) {
      res.status(400).json({ error: 'name or settings (nightOf/setupId) required' }); return;
    }
    const existing = getPlan(id);
    if (!existing) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (hasName) {
      const { name } = body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required' }); return;
      }
      renamePlan(id, name.trim());
    }
    if (hasSettings) {
      const nightOf = 'nightOf' in body ? (body.nightOf || null) : (existing.night_of ?? null);
      const setupId = 'setupId' in body ? (body.setupId || null) : (existing.setup_id ?? null);
      updatePlanSettings(id, nightOf, setupId);
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to update plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}:
 *   delete:
 *     summary: Delete a night plan and its entries
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     responses:
 *       200:
 *         description: Plan deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.delete('/api/plans/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!deletePlan(id)) { res.status(404).json({ error: 'Plan not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to delete plan', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries:
 *   post:
 *     summary: Add a target to a plan (DSO or custom location)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       description: Provide `dsoId` for a catalog target, or `ra`/`dec` for a custom-location frame on empty sky.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dsoId: { type: string, description: DSO catalog id (omit for a custom location) }
 *               ra: { type: number, description: Frame-centre right ascension (deg), required for a custom location }
 *               dec: { type: number, description: Frame-centre declination (deg), required for a custom location }
 *               paDeg: { type: number, description: Framing position angle (°E of N) }
 *     responses:
 *       200:
 *         description: Entry added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400:
 *         description: Missing dsoId or ra/dec
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Plan not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       409:
 *         description: Target already in plan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 code: { type: string, enum: [DUPLICATE_ENTRY] }
 *       500:
 *         description: Server error
 */
app.post('/api/plans/:id/entries', (req, res) => {
  try {
    const { id } = req.params;
    const { dsoId, ra, dec, paDeg } = req.body as any;
    if (!getPlan(id)) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (dsoId == null) {
      // Custom-location entry (framed on empty sky): no DSO, ra/dec required.
      if (typeof ra !== 'number' || typeof dec !== 'number') {
        res.status(400).json({ error: 'dsoId or ra/dec is required' }); return;
      }
    } else {
      if (typeof dsoId !== 'string') { res.status(400).json({ error: 'dsoId must be a string' }); return; }
      if (planEntryExists(id, dsoId)) {
        res.status(409).json({ error: 'Target already in plan', code: 'DUPLICATE_ENTRY' }); return;
      }
    }
    const entryId = `pe-${uuidv4()}`;
    addPlanEntry({
      id: entryId, plan_id: id, dso_id: dsoId ?? null, position: nextPlanEntryPosition(id),
      pa_deg: typeof paDeg === 'number' ? paDeg : null,
      ra: typeof ra === 'number' ? ra : null, dec: typeof dec === 'number' ? dec : null, notes: null,
    });
    res.json({ id: entryId });
  } catch (err: any) {
    console.error('[Plans] Failed to add entry', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/order:
 *   put:
 *     summary: Reorder the entries within a plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: Entry IDs in the desired order
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: ids must be an array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.put('/api/plans/:id/entries/order', (req, res) => {
  try {
    const { id } = req.params;
    const { ids } = req.body as any;
    if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids must be an array' }); return; }
    reorderPlanEntries(id, ids);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to reorder entries', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/{entryId}:
 *   delete:
 *     summary: Remove a target from a plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *         description: Entry ID
 *     responses:
 *       200:
 *         description: Entry removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       404:
 *         description: Entry not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.delete('/api/plans/:id/entries/:entryId', (req, res) => {
  try {
    const { entryId } = req.params;
    if (!removePlanEntry(entryId)) { res.status(404).json({ error: 'Entry not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to remove entry', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/plans/{id}/entries/{entryId}:
 *   patch:
 *     summary: Update a plan entry's framing (position angle, frame centre, and target DSO)
 *     description: >
 *       Updates only the fields present in the body. `paDeg` sets the framing
 *       rotation. `ra`/`dec` set the frame-centre sky coordinates. `dsoId` sets
 *       the target DSO (or null for a custom location with no catalogued object).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Plan ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *         description: Entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paDeg:
 *                 type: number
 *                 nullable: true
 *                 description: Framing position angle in degrees east of celestial north (0–360), or null to clear
 *               ra:
 *                 type: number
 *                 nullable: true
 *                 description: Frame-centre right ascension in degrees, or null to clear (use the DSO position)
 *               dec:
 *                 type: number
 *                 nullable: true
 *                 description: Frame-centre declination in degrees, or null to clear
 *               dsoId:
 *                 type: string
 *                 nullable: true
 *                 description: Target DSO id, or null for a custom location
 *     responses:
 *       200:
 *         description: Entry updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *       400:
 *         description: A provided field has the wrong type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       404:
 *         description: Entry not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
app.patch('/api/plans/:id/entries/:entryId', (req, res) => {
  try {
    const { entryId } = req.params;
    const body = req.body as Record<string, unknown>;
    const fields: { ra?: number | null; dec?: number | null; paDeg?: number | null; dsoId?: string | null } = {};

    if ('paDeg' in body) {
      if (body.paDeg !== null && typeof body.paDeg !== 'number') {
        res.status(400).json({ error: 'paDeg must be a number or null' }); return;
      }
      fields.paDeg = body.paDeg as number | null;
    }
    if ('ra' in body) {
      if (body.ra !== null && typeof body.ra !== 'number') {
        res.status(400).json({ error: 'ra must be a number or null' }); return;
      }
      fields.ra = body.ra as number | null;
    }
    if ('dec' in body) {
      if (body.dec !== null && typeof body.dec !== 'number') {
        res.status(400).json({ error: 'dec must be a number or null' }); return;
      }
      fields.dec = body.dec as number | null;
    }
    if ('dsoId' in body) {
      if (body.dsoId !== null && typeof body.dsoId !== 'string') {
        res.status(400).json({ error: 'dsoId must be a string or null' }); return;
      }
      fields.dsoId = body.dsoId as string | null;
    }

    if (Object.keys(fields).length === 0) {
      res.status(400).json({ error: 'No updatable fields provided' }); return;
    }
    if (!updatePlanEntryFrame(entryId, fields)) { res.status(404).json({ error: 'Entry not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Plans] Failed to update entry PA', err);
    res.status(500).json({ error: err.message });
  }
});

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
      options?: { includeImages?: boolean; includeMetadata?: boolean; includeDsoOverrides?: boolean; includeCustomGear?: boolean; includeSetups?: boolean; includePlans?: boolean };
      ids?: string[];
    };

    // Support legacy mode='metadata' for backward compat with backup button
    const legacyMetadataOnly = body.mode === 'metadata';
    const options = body.options ?? {};
    const includeImages = legacyMetadataOnly ? false : (options.includeImages !== false);
    const includeMetadata = options.includeMetadata !== false;
    const includeDsoOverrides = options.includeDsoOverrides === true;
    const includeCustomGear = options.includeCustomGear === true;
    const includeSetups = options.includeSetups === true;
    const includePlans = options.includePlans === true;

    const { ids } = body;
    const allPhotos = getAllPhotos();
    const selected = Array.isArray(ids) && ids.length > 0
      ? allPhotos.filter(p => ids.includes(p.id))
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
    archive.on('error', (err) => { console.error('[Export] archiver error:', err); });
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
      archive.append(Buffer.from(JSON.stringify(overrides, null, 2)), { name: 'dso-overrides.json' });
    }
    if (includeCustomGear) {
      const customGear = getAllCustomGear().map(g => ({ id: g.id, type: g.type, ...JSON.parse(g.data) }));
      archive.append(Buffer.from(JSON.stringify(customGear, null, 2)), { name: 'custom-gear.json' });
    }
    if (includeSetups) {
      const setups = getAllGearSetups().map(r => ({
        id: r.id,
        name: r.name,
        telescopeId: r.telescope_id,
        cameraId: r.camera_id,
        accessoryId: r.accessory_id,
        enabled: r.enabled === 1,
      }));
      archive.append(Buffer.from(JSON.stringify(setups, null, 2)), { name: 'gear-setups.json' });
    }
    if (includePlans) {
      const entriesByPlan = new Map<string, PlanEntryRow[]>();
      for (const e of getAllPlanEntries()) {
        const list = entriesByPlan.get(e.plan_id) ?? [];
        list.push(e);
        entriesByPlan.set(e.plan_id, list);
      }
      const plans = getPlans().map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nightOf: p.night_of ?? null,
        setupId: p.setup_id ?? null,
        entries: (entriesByPlan.get(p.id) ?? []).map(e => ({
          id: e.id, dsoId: e.dso_id ?? null, position: e.position, paDeg: e.pa_deg ?? null,
          ra: e.ra ?? null, dec: e.dec ?? null, notes: e.notes ?? null,
        })),
      }));
      archive.append(Buffer.from(JSON.stringify(plans, null, 2)), { name: 'plans.json' });
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
    if (!file) { res.status(400).json({ error: 'Aucun fichier fourni' }); return; }

    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      const zipDir = await unzipper.Open.buffer(file.buffer);
      const inspect = await inspectZipContents(zipDir.files as any);

      const filenameToOriginalName = new Map(inspect.photos.map(p => [p.filename, p.originalName]));
      const originalNames = inspect.photos.map(p => p.originalName).filter(Boolean);
      const existingSet = new Set(
        originalNames.length > 0
          ? checkPhotosExistByName(originalNames).map(r => r.originalName)
          : []
      );

      const images = inspect.imageEntries.map(entry => ({
        filename: entry.filename,
        originalName: filenameToOriginalName.get(entry.filename) ?? entry.filename,
        size: entry.size,
        exists: existingSet.has(filenameToOriginalName.get(entry.filename) ?? ''),
      }));

      res.json({
        hasMetadata: inspect.hasMetadata && inspect.photos.length > 0,
        photos: inspect.photos.length,
        hasDsoOverrides: inspect.hasDsoOverrides,
        hasCustomGear: inspect.hasCustomGear,
        hasSetups: inspect.hasSetups,
        images,
      });
    } else if (ext === '.json') {
      const photos = JSON.parse(file.buffer.toString('utf8'));
      if (!Array.isArray(photos)) { res.status(400).json({ error: 'Format de manifeste invalide' }); return; }
      res.json({
        hasMetadata: photos.length > 0,
        photos: photos.length,
        hasDsoOverrides: false,
        hasCustomGear: false,
        hasSetups: false,
        images: [],
      });
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' }); return;
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
// Form fields: bundle (file), importMetadata, importDsoOverrides, importCustomGear, importSetups, importPlans, selectedImages (JSON string[])
app.post('/api/import', uploadBundle.single('bundle'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'Aucun fichier fourni' }); return; }

    const importMetadata = req.body?.importMetadata === '1';
    const importDsoOverrides = req.body?.importDsoOverrides === '1';
    const importCustomGear = req.body?.importCustomGear === '1';
    const importSetups = req.body?.importSetups === '1';
    const importPlans = req.body?.importPlans === '1';
    // null means "no image filter" (metadata-only import); a Set means "import only these filenames"
    const selectedImages: Set<string> | null = req.body?.selectedImages
      ? new Set(JSON.parse(req.body.selectedImages) as string[])
      : null;

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
          res.status(400).json({ error: `Chemin invalide dans le ZIP : ${entry.path}` }); return;
        }
      }

      const manifestEntry = zipDir.files.find(f => f.path === 'manifest.json');
      const dsoOverridesEntry = zipDir.files.find(f => f.path === 'dso-overrides.json');
      const customGearEntry = zipDir.files.find(f => f.path === 'custom-gear.json');
      const gearSetupsEntry = zipDir.files.find(f => f.path === 'gear-setups.json');
      const plansEntry = zipDir.files.find(f => f.path === 'plans.json');

      if (!manifestEntry && !dsoOverridesEntry && !customGearEntry && !gearSetupsEntry) {
        res.status(400).json({ error: 'Aucun contenu reconnu dans le ZIP' }); return;
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
              if (typeof id === 'string' && id.length <= 100 && typeof data === 'object' && data !== null && !Array.isArray(data)) {
                upsertDsoOverrideDB(id, data as object);
                dsoOverridesImported++;
              }
            }
          }
        } catch { /* ignore invalid dso-overrides.json */ }
      }

      // Import custom gear
      if (customGearEntry && importCustomGear) {
        try {
          const rawGear = JSON.parse((await customGearEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawGear)) {
            for (const g of rawGear) {
              if (typeof g.id === 'string' && ['telescope', 'camera', 'accessory'].includes(g.type)) {
                const { id, type, ...data } = g;
                upsertCustomGearDB(id, type as 'telescope' | 'camera' | 'accessory', { ...data, id });
              }
            }
          }
        } catch { /* ignore invalid custom-gear.json */ }
      }

      // Import gear setups
      if (gearSetupsEntry && importSetups) {
        try {
          const rawSetups = JSON.parse((await gearSetupsEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawSetups)) {
            for (const s of rawSetups) {
              if (typeof s.id === 'string' && typeof s.telescopeId === 'string' && typeof s.cameraId === 'string') {
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
        } catch { /* ignore invalid gear-setups.json */ }
      }

      // Import night plans. Re-import is idempotent: a plan with the same id is
      // deleted (with its entries) then re-created.
      if (plansEntry && importPlans) {
        try {
          const rawPlans = JSON.parse((await plansEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawPlans)) {
            rawPlans.forEach((p, pi) => {
              if (typeof p.id !== 'string' || typeof p.name !== 'string') return;
              deletePlan(p.id);
              createPlan({
                id: p.id,
                name: p.name,
                position: typeof p.position === 'number' ? p.position : pi,
                created_at: new Date().toISOString(),
                night_of: typeof p.nightOf === 'string' ? p.nightOf : null,
                setup_id: typeof p.setupId === 'string' ? p.setupId : null,
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
                  });
                });
              }
            });
          }
        } catch { /* ignore invalid plans.json */ }
      }

      // Flush libvips handle cache before writing to avoid Windows sharing violations
      // when re-importing the same files that sharp processed in a previous request.
      sharp.cache(false);

      // Extract selected image files to UPLOADS_DIR (always overwrite)
      const imageEntries = zipDir.files.filter(f => f.path.startsWith('images/') && f.type === 'File');
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
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' }); return;
    }

    if (!Array.isArray(photos)) { res.status(400).json({ error: 'Format de manifeste invalide' }); return; }

    let imported = 0;
    let skipped = 0;

    if (importMetadata && photos.length > 0) {
      const allNames = photos.map((p: any) => p.originalName ?? p.filename ?? p.id).filter(Boolean);
      const existingByName = new Map(
        checkPhotosExistByName(allNames).map(r => [r.originalName, r.id])
      );

      for (const p of photos) {
        if (!p.id || typeof p.id !== 'string') { skipped++; continue; }
        const origName: string = p.originalName ?? p.filename ?? p.id;

        // Skip photos whose image file was not written (not selected, or write failed)
        if (writtenFiles !== null && !writtenFiles.has(p.filename)) {
          skipped++;
          continue;
        }

        const existingId = existingByName.get(origName);
        if (existingId) deletePhoto(existingId);

        const corrs = Array.isArray(p.correspondences) ? p.correspondences : [];
        const thumbFilename = typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null;
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
        );
        if (result === 'imported') imported++; else skipped++;
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
 * /api/photos/{id}:
 *   delete:
 *     summary: Delete an uploaded photo
 *     description: Delete a photo from the database and disk storage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID of the photo to delete
 *     responses:
 *       200:
 *         description: Photo deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       404:
 *         description: Photo not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Photo introuvable"
 *                 code:
 *                   type: string
 *                   enum: [PHOTO_NOT_FOUND]
 *       500:
 *         description: Server error
 */
// Delete a photo
app.delete('/api/photos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filename = getPhotoFilename(id);

    if (!filename) {
      res.status(404).json({ error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' });
      return;
    }

    // Delete main file and thumbnail from disk
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbPath = path.join(UPLOADS_DIR, filename.replace(/(\.[^.]+)$/, '_thumb.jpg'));
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    deletePhoto(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/photos:
 *   delete:
 *     summary: Bulk delete photos by ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of photo UUIDs to delete
 *     responses:
 *       200:
 *         description: Photos deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: number
 *       400:
 *         description: Invalid request — ids must be an array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 */
app.delete('/api/photos', (req, res) => {
  try {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array' });
      return;
    }
    let deleted = 0;
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const filename = getPhotoFilename(id);
      if (!filename) continue;
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const thumbPath = path.join(UPLOADS_DIR, filename.replace(/(\.[^.]+)$/, '_thumb.jpg'));
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      deletePhoto(id);
      deleted++;
    }
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] Bulk photo delete failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/photo-metadata:
 *   delete:
 *     summary: Delete all photo metadata from the database
 *     description: Removes all photo records and their star correspondences from the database. Image files on disk are NOT deleted.
 *     responses:
 *       200:
 *         description: All photo metadata deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 deleted:
 *                   type: number
 *       500:
 *         description: Server error
 */
app.delete('/api/photo-metadata', (_req, res) => {
  try {
    const deleted = deleteAllPhotoMetadataDB();
    res.json({ ok: true, deleted });
  } catch (err: any) {
    console.error('[DeleteAll] Photo metadata delete failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/photos/{id}/manual-placement:
 *   patch:
 *     summary: Update manual placement metadata for a photo
 *     description: Update the manual sky map placement coordinates for a photo
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID of the photo to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               manualPlacement:
 *                 type: object
 *                 description: Manual placement object with projPerPx and transformation matrix
 *     responses:
 *       200:
 *         description: Manual placement updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       404:
 *         description: Photo not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Photo introuvable"
 *                 code:
 *                   type: string
 *                   enum: [PHOTO_NOT_FOUND]
 *       500:
 *         description: Server error
 */
// Update photo manual placement
app.patch('/api/photos/:id/manual-placement', (req, res) => {
  try {
    const { id } = req.params;
    const { manualPlacement } = req.body;

    if (!getPhotoFilename(id)) {
      res.status(404).json({ error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' });
      return;
    }

    const manualPlacementJson = manualPlacement ? JSON.stringify(manualPlacement) : null;
    const success = updatePhotoManualPlacement(id, manualPlacementJson);

    if (success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to update photo' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/photos/{id}/metadata:
 *   patch:
 *     summary: Update photo metadata including DSO ids, labels, notes, and integrations
 *     description: Update photo metadata such as associated DSOs, labels, observation notes, and integration details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID of the photo to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dsoIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of DSO catalog identifiers (e.g. ["M1", "NGC253"])
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Custom observation labels
 *               notes:
 *                 type: string
 *                 description: Observation notes (max 5000 characters)
 *               integrations:
 *                 type: array
 *                 description: Integration details (frames, seconds, filter)
 *               originalName:
 *                 type: string
 *                 description: Photo display name (max 255 characters)
 *               observationDate:
 *                 type: string
 *                 description: Observation start date/time (UTC ISO 8601, max 50 characters, null to clear)
 *     responses:
 *       200:
 *         description: Photo metadata updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 originalName:
 *                   type: string
 *                   description: Updated display name (if provided)
 *       404:
 *         description: Photo not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Photo introuvable"
 *                 code:
 *                   type: string
 *                   enum: [PHOTO_NOT_FOUND]
 *       500:
 *         description: Server error
 */
// Update photo metadata (dsoIds, labels, notes)
app.patch('/api/photos/:id/metadata', (req, res) => {
  try {
    const { id } = req.params;

    if (!getPhotoFilename(id)) {
      res.status(404).json({ error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' });
      return;
    }

    let { dsoIds, labels, integrations, notes, originalName, observationDate } = req.body;
    if (!Array.isArray(dsoIds)) dsoIds = [];
    if (!Array.isArray(labels)) labels = [];
    integrations = sanitizeIntegrationRows(integrations);
    if (typeof notes !== 'string') notes = '';
    notes = notes.slice(0, 5000);
    const resolvedOriginalName: string | undefined =
      typeof originalName === 'string' && originalName.trim()
        ? originalName.trim().slice(0, 255)
        : undefined;
    const resolvedObsDate: string | null =
      typeof observationDate === 'string' && observationDate.trim()
        ? observationDate.trim().slice(0, 50)
        : null;

    updatePhotoMetadata(id, dsoIds, labels, notes, resolvedOriginalName, integrations, resolvedObsDate);
    res.json({ ok: true, ...(resolvedOriginalName !== undefined ? { originalName: resolvedOriginalName } : {}) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
 *       400:
 *         description: Missing file, unsupported format, or no WCS data found
 *       500:
 *         description: Server error
 */
// --- WCS solve route ---
app.post('/api/solve-wcs', uploadWCS.single('photo'), async (req, res) => {
  try {
    // Get language from request (default to 'en')
    const lang = ((req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : 'en') as ServerLang;
    
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: msg.api.noFile(lang), code: 'NO_FILE' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_WCS_EXTENSIONS.has(ext)) {
      res.status(400).json({ success: false, error: msg.api.unsupportedWcsFormat(lang), code: 'UNSUPPORTED_FORMAT' });
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
      res.json({ success: false, error: msg.api.noImageDimensions(lang), code: 'NO_IMAGE_DIMENSIONS' });
      return;
    }

    loadServerCatalog();
    // Standard FITS files from PixInsight/Siril use FITS Y convention (Y=1 = bottom row,
    // Y increases upward), which is opposite to display/screen convention (Y=0 = top row).
    // Pass fitsYConvention=true so pixel positions are correctly flipped when mapping
    // catalog stars into the image's display coordinate space.
    const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight, true);

    if (correspondences.length < 3) {
      res.json({ success: false, error: msg.api.notEnoughCatalogStars(lang), code: 'NOT_ENOUGH_CATALOG_STARS' });
      return;
    }

    // Rescale correspondences to target (display image) dimensions if provided
    const targetWidth = parseInt(req.body.targetWidth || '0', 10);
    const targetHeight = parseInt(req.body.targetHeight || '0', 10);

    let finalCorrespondences = correspondences;
    let dimensionWarning: { sourceW: number; sourceH: number; targetW: number; targetH: number; aspectMismatch: boolean } | undefined;

    if (targetWidth > 0 && targetHeight > 0 && (targetWidth !== imageWidth || targetHeight !== imageHeight)) {
      const sourceAspect = imageWidth / imageHeight;
      const targetAspect = targetWidth / targetHeight;
      const aspectDiff = Math.abs(sourceAspect - targetAspect) / sourceAspect;
      const aspectMismatch = aspectDiff > 0.01; // >1% aspect ratio difference

      dimensionWarning = { sourceW: imageWidth, sourceH: imageHeight, targetW: targetWidth, targetH: targetHeight, aspectMismatch };

      const scaleX = targetWidth / imageWidth;
      const scaleY = targetHeight / imageHeight;
      finalCorrespondences = correspondences.map(c => ({
        ...c,
        photoX: c.photoX * scaleX,
        photoY: c.photoY * scaleY,
      }));
      console.log(`[WCS] Rescaled correspondences: source ${imageWidth}x${imageHeight} → target ${targetWidth}x${targetHeight} (aspectMismatch=${aspectMismatch})`);
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
    });
  } catch (err: any) {
    console.error('WCS solve error:', err);
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
  const lang = ((req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : 'en') as ServerLang;

  if (!req.file) {
    res.status(400).json({ error: lang === 'fr' ? 'Fichier manquant' : 'Missing file', code: 'MISSING_FILE' });
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
          fileBuffer, ext, width, height,
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
          result.correspondences = result.correspondences.map(c => {
            const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, orientation);
            return { ...c, photoX: x, photoY: y };
          });
        }
        updateJob(job.id, { status: result.success ? 'success' : 'failed', result, error: result.error });
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
  const lang = ((req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : 'en') as ServerLang;

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
          fileBuffer, ext, width, height,
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
          result.correspondences = result.correspondences.map(c => {
            const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, orientation);
            return { ...c, photoX: x, photoY: y };
          });
        }
        updateJob(job.id, { status: result.success ? 'success' : 'failed', result, error: result.error });
      } catch (err: any) {
        if (err?.code === 'SOLVE_CANCELED') {
          updateJob(job.id, { status: 'canceled' });
        } else {
          console.error('[SolveField] Background solve error:', err);
          updateJob(job.id, { status: 'failed', error: err.message || 'Unknown solve-field error' });
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
    const lang = (req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : 'en';
    
    if (!isAstrometryConfigured()) {
      res.status(400).json({ error: lang === 'fr' ? 'ASTROMETRY_API_KEY non configurée sur le serveur' : 'ASTROMETRY_API_KEY not configured on server', code: 'ASTROMETRY_NOT_CONFIGURED' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided', code: 'NO_FILE' });
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
      res.status(400).json({ error: lang === 'fr' ? 'Impossible de déterminer les dimensions de l\'image' : 'Cannot determine image dimensions', code: 'CANNOT_DETERMINE_DIMENSIONS' });
      return;
    }

    // Parse optional hints from request body
    const hints: { ra?: number; dec?: number; radius?: number; scale_lower?: number; scale_upper?: number } = {};
    if (req.body.ra !== undefined) hints.ra = parseFloat(req.body.ra);
    if (req.body.dec !== undefined) hints.dec = parseFloat(req.body.dec);
    if (req.body.radius !== undefined) hints.radius = parseFloat(req.body.radius);
    if (req.body.scale_lower !== undefined) hints.scale_lower = parseFloat(req.body.scale_lower);
    if (req.body.scale_upper !== undefined) hints.scale_upper = parseFloat(req.body.scale_upper);

    const jobId = await submitJob(file.buffer, file.originalname, imageWidth, imageHeight, Object.keys(hints).length > 0 ? hints : undefined);
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
      res.status(400).json({ error: 'ASTROMETRY_API_KEY not configured', code: 'ASTROMETRY_NOT_CONFIGURED' });
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
    const lang = (req.body.lang === 'fr' || req.body.lang === 'en') ? req.body.lang : 'en';
    
    if (!isAstrometryConfigured()) {
      res.status(400).json({ error: lang === 'fr' ? 'ASTROMETRY_API_KEY non configurée' : 'ASTROMETRY_API_KEY not configured', code: 'ASTROMETRY_NOT_CONFIGURED' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided', code: 'NO_FILE' });
      return;
    }

    const jobId = parseInt(req.body.jobId, 10);
    if (!jobId || isNaN(jobId)) {
      res.status(400).json({ error: lang === 'fr' ? 'Job ID invalide' : 'Invalid job ID', code: 'INVALID_JOB_ID' });
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
      res.status(400).json({ error: lang === 'fr' ? 'Impossible de déterminer les dimensions' : 'Cannot determine image dimensions', code: 'CANNOT_DETERMINE_DIMENSIONS' });
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

/**
 * @swagger
 * /api/stars/search:
 *   get:
 *     summary: Search stars by name or catalog identifier
 *     responses:
 *       200:
 *         description: Star search results returned successfully
 */
// --- Star search API ---
app.get('/api/stars/search', (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10), 50);
    const results = searchDeepStars(q, limit);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/stars/nearby:
 *   get:
 *     summary: Search stars near a given position
 *     responses:
 *       200:
 *         description: Nearby stars returned successfully
 */
app.get('/api/stars/nearby', (req, res) => {
  try {
    const ra = parseFloat(String(req.query.ra || '0'));
    const dec = parseFloat(String(req.query.dec || '0'));
    const radius = parseFloat(String(req.query.radius || '5'));
    const magLimit = parseFloat(String(req.query.magLimit || '10'));
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20), 100);
    
    const results = searchStarsByPosition(ra, dec, radius, magLimit, limit);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/stars/{hip}:
 *   get:
 *     summary: Get deep star details by HIP identifier
 *     parameters:
 *       - in: path
 *         name: hip
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Star details returned successfully
 */
app.get('/api/stars/:hip', (req, res) => {
  try {
    const hip = parseInt(req.params.hip, 10);
    if (isNaN(hip)) {
      res.status(400).json({ error: 'HIP invalide', code: 'INVALID_HIP' });
      return;
    }
    const star = getDeepStarByHip(hip);
    if (!star) {
      res.status(404).json({ error: 'Étoile introuvable', code: 'STAR_NOT_FOUND' });
      return;
    }
    res.json(star);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// startServer is async so swagger routes are always registered before the SPA catch-all,
// guaranteeing correct ordering regardless of dist/ presence.
async function startServer() {
  // swagger: dev only — not available in Electron/production (swagger-ui-express is a devDependency
  // and swagger.json is not embedded in the Electron bundle).
  if (enableSwagger) {
    const swaggerJsonPath = path.join(__dirname, '../public/swagger.json');
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
        console.warn('[Swagger] dev docs disabled; swagger-ui-express unavailable.', err?.message ?? err);
      }
    } else {
      console.warn('[Swagger] dev docs disabled; public/swagger.json not found. Run npm run swagger:generate.');
    }
  }

  // SPA fallback — registered after swagger so the ordering is deterministic.
  // The /api guard is belt-and-suspenders: ensures API paths are never swallowed
  // by this catch-all even if a future refactor breaks the ordering again.
  if (fs.existsSync(DIST_DIR)) {
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api')) { next(); return; }
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

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
    console.log(`Star catalog: ${catalogPath}`);
  });
}

startServer();
