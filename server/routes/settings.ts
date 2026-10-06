import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { SettingsChanges } from '@myastrosky/core/domain/settings';
import { settings, version } from '../services.js';
import { logServerError } from '../logger.js';
import { sendError } from './http-errors.js';
import { probeAstap, probeSolveField, probeDataDir } from '../probe-utils.js';

export const settingsRouter = express.Router();

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
  res.json(await version.getLatest());
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
    res.json(await settings.readPublic());
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
    await settings.update(req.body as SettingsChanges);
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
