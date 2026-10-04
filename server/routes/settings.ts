import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import { settings } from '../services.js';
import { logServerError } from '../logger.js';
import { sendError } from './http-errors.js';
import { resetSession as resetAstrometrySession } from '../astrometry.js';
import { probeAstap, probeSolveField, probeDataDir } from '../probe-utils.js';
import { parseLatestRelease, type LatestRelease } from '../github-release.js';

export const settingsRouter = express.Router();

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
settingsRouter.get('/api/version/latest', async (_req, res) => {
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
settingsRouter.get('/api/config', (_req, res) => {
  const catalogPath = process.env.STAR_CATALOG_PATH || 'public/data/stars.14.json';
  // Extract just the filename from the path for the frontend URL
  const catalogFile = path.basename(catalogPath);
  res.json({
    starCatalog: `/data/${catalogFile}`,
  });
});

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get current API and solver settings
 *     responses:
 *       200:
 *         description: Settings returned successfully
 */
settingsRouter.get('/api/settings', async (_req, res) => {
  try {
    const { apiKeySet, ...rest } = await settings.readPublic();
    res.json({ apiKeySet, isWindows: process.platform === 'win32', ...rest });
  } catch (err) {
    if (!isDomainError(err)) logServerError('settings_read_failed', err);
    sendError(res, err);
  }
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
settingsRouter.put('/api/settings', async (req, res) => {
  try {
    const { apiKeyChanged } = await settings.update(req.body);
    if (apiKeyChanged) resetAstrometrySession(); // invalidate cached session for the old key
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) logServerError('settings_update_failed', err);
    sendError(res, err);
  }
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
settingsRouter.delete('/api/settings/astrometry-api-key', async (_req, res) => {
  try {
    await settings.removeApiKey();
    resetAstrometrySession();
    res.json({ ok: true });
  } catch (err) {
    if (!isDomainError(err)) logServerError('settings_delete_key_failed', err);
    sendError(res, err);
  }
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
settingsRouter.post('/api/settings/probe-astap', async (req, res) => {
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
settingsRouter.post('/api/settings/probe-solve-field', async (req, res) => {
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
settingsRouter.post('/api/settings/probe-data-dir', async (req, res) => {
  const { dir = '', useWSL = false } = req.body as { dir?: string; useWSL?: boolean };
  const result = await probeDataDir(dir, !!useWSL, process.platform, execFileAsync as any);
  res.json(result);
});
