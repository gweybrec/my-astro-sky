import express from 'express';
import { randomUUID } from 'crypto';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import { shareFileName, type ShareRequest } from '@myastrosky/core/domain/shared-sky';
import { uploadBundle } from './shared.js';
import { sharedSkies, sharedSkyImports } from '../services.js';
import { createZipResponseWriter } from '../bundle-zip.js';
import { logServerError } from '../logger.js';
import { sendError } from './http-errors.js';

export const sharedSkiesRouter = express.Router();

function fail(res: express.Response, event: string, err: unknown): void {
  if (!isDomainError(err)) logServerError(event, err);
  sendError(res, err);
}

/** What a share asks for, read from a request body: a name, the photo ids and whether gear travels. */
function shareRequestOf(body: unknown): ShareRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    senderName: typeof b.senderName === 'string' ? b.senderName : '',
    includeGear: b.includeGear !== false,
    ids: Array.isArray(b.ids)
      ? b.ids.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
}

/**
 * The shares asked for and not yet downloaded. The browser downloads a package itself, straight to disk, so the
 * request (which can list hundreds of photo ids) is kept here under a token the download address carries.
 */
const pendingExports = new Map<string, { request: ShareRequest; timer: NodeJS.Timeout }>();
const EXPORT_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * @swagger
 * /api/shared-skies/sender:
 *   get:
 *     summary: The display name last shared under
 *     responses:
 *       200:
 *         description: The name ('' before the first share)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 senderName: { type: string }
 */
sharedSkiesRouter.get('/api/shared-skies/sender', async (_req, res) => {
  try {
    res.json({ senderName: await sharedSkies.senderName() });
  } catch (err) {
    fail(res, 'shared_sky_sender_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies/export:
 *   post:
 *     summary: Prepare a shared-sky package for download
 *     description: >
 *       Checks the request and keeps it for a few minutes under a token. The package itself is then downloaded
 *       with `GET /api/shared-skies/export/{token}`, so the browser writes it straight to disk.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               senderName: { type: string, description: The display name written in the package }
 *               includeGear: { type: boolean, description: Whether gear and capture details travel (default true) }
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: The photos to share; all of them when absent or empty
 *     responses:
 *       200:
 *         description: The token and the file name of the package
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 fileName: { type: string }
 *       400:
 *         description: A blank name (`SHARED_SKY_NAME_REQUIRED`) or no photo to share (`SHARED_SKY_NOTHING_TO_SHARE`)
 */
sharedSkiesRouter.post('/api/shared-skies/export', async (req, res) => {
  try {
    const request = shareRequestOf(req.body);
    await sharedSkies.checkShare(request);
    const token = randomUUID();
    const timer = setTimeout(() => pendingExports.delete(token), EXPORT_TOKEN_TTL_MS);
    timer.unref();
    pendingExports.set(token, { request, timer });
    res.json({ token, fileName: shareFileName(request.senderName) });
  } catch (err) {
    fail(res, 'shared_sky_export_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies/export/{token}:
 *   get:
 *     summary: Download a prepared shared-sky package
 *     description: A ZIP named `<name>.myastrosky`, streamed. The token works once.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The package
 *       404:
 *         description: Unknown or used token
 */
sharedSkiesRouter.get('/api/shared-skies/export/:token', async (req, res) => {
  const pending = pendingExports.get(req.params.token);
  if (!pending) {
    res.status(404).json({ error: 'Unknown export', code: 'SHARED_SKY_TICKET_EXPIRED' });
    return;
  }
  pendingExports.delete(req.params.token);
  clearTimeout(pending.timer);
  let zip: ReturnType<typeof createZipResponseWriter> | null = null;
  try {
    const fileName = shareFileName(pending.request.senderName);
    zip = createZipResponseWriter(res, () => {
      res.setHeader('Content-Type', 'application/zip');
      // The name may hold letters a header cannot: the plain form is ASCII, the starred one carries the real name.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
    });
    await sharedSkies.exportTo(zip, pending.request);
    await zip.finalize();
  } catch (err) {
    zip?.abort();
    if (!isDomainError(err)) logServerError('shared_sky_export_failure', err);
    if (!res.headersSent) sendError(res, err);
    else res.destroy();
  }
});

/**
 * @swagger
 * /api/shared-skies/inspect:
 *   post:
 *     summary: Upload a shared-sky package and read what it holds
 *     description: >
 *       The package is written to a file on the server and nothing is imported. The answer carries a ticket for
 *       `POST /api/shared-skies/open/{ticket}`; discard it with `DELETE` when the package is not opened.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               bundle:
 *                 type: string
 *                 format: binary
 *                 description: The `.myastrosky` (or `.zip`) package
 *     responses:
 *       200:
 *         description: The ticket and the preview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ticket: { type: string }
 *                 preview:
 *                   type: object
 *                   properties:
 *                     skyId: { type: string }
 *                     senderName: { type: string }
 *                     sharedAt: { type: string }
 *                     photoCount: { type: integer }
 *                     bytes: { type: integer }
 *                     status: { type: string, enum: [new, update, same, older] }
 *                     existing:
 *                       type: object
 *                       properties:
 *                         displayName: { type: string }
 *                         sharedAt: { type: string }
 *                         photoCount: { type: integer }
 *                     freeBytes: { type: integer, nullable: true }
 *       400:
 *         description: No file, or not a usable package (`NOT_A_SHARED_SKY`, `SHARED_SKY_UNSUPPORTED`, `INVALID_ENTRY_PATH`, `BACKUP_TOO_LARGE`)
 */
sharedSkiesRouter.post(
  '/api/shared-skies/inspect',
  uploadBundle.single('bundle'),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }
    try {
      res.json(await sharedSkyImports.inspect(file.path));
    } catch (err) {
      fail(res, 'shared_sky_inspect_failure', err);
    }
  },
);

/**
 * @swagger
 * /api/shared-skies/open/{ticket}:
 *   post:
 *     summary: Start keeping an inspected package as a visit
 *     description: The import runs on the server; follow it with `GET` on the same address.
 *     parameters:
 *       - in: path
 *         name: ticket
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Started (or already running)
 *       404:
 *         description: Unknown ticket (`SHARED_SKY_TICKET_EXPIRED`)
 *   get:
 *     summary: Where the import of a package stands
 *     parameters:
 *       - in: path
 *         name: ticket
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The state; `sky` once done, `error` once failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 state: { type: string, enum: [ready, running, done, failed, cancelled] }
 *                 done: { type: integer }
 *                 total: { type: integer }
 *                 sky: { type: object }
 *                 error:
 *                   type: object
 *                   properties:
 *                     kind: { type: string }
 *                     code: { type: string }
 *                     message: { type: string }
 *       404:
 *         description: Unknown ticket (`SHARED_SKY_TICKET_EXPIRED`)
 *   delete:
 *     summary: Give up or forget a package
 *     description: A running import is cancelled and leaves nothing behind; the uploaded file is removed.
 *     parameters:
 *       - in: path
 *         name: ticket
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Done (also for an unknown ticket)
 */
sharedSkiesRouter.post('/api/shared-skies/open/:ticket', (req, res) => {
  try {
    sharedSkyImports.start(req.params.ticket);
    res.status(202).json(sharedSkyImports.status(req.params.ticket));
  } catch (err) {
    fail(res, 'shared_sky_open_failure', err);
  }
});

sharedSkiesRouter.get('/api/shared-skies/open/:ticket', (req, res) => {
  try {
    res.json(sharedSkyImports.status(req.params.ticket));
  } catch (err) {
    fail(res, 'shared_sky_open_failure', err);
  }
});

sharedSkiesRouter.delete('/api/shared-skies/open/:ticket', async (req, res) => {
  try {
    await sharedSkyImports.discard(req.params.ticket);
    res.json({ success: true });
  } catch (err) {
    fail(res, 'shared_sky_open_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies/make-mediums:
 *   post:
 *     summary: Make the missing medium-sized copies of visited photos
 *     responses:
 *       200:
 *         description: How many copies were made
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 made: { type: integer }
 */
sharedSkiesRouter.post('/api/shared-skies/make-mediums', async (_req, res) => {
  try {
    res.json({ made: await sharedSkies.makeMissingMediums() });
  } catch (err) {
    fail(res, 'shared_sky_medium_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies:
 *   get:
 *     summary: The visited skies
 *     responses:
 *       200:
 *         description: The visits, the most recently received first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   senderName: { type: string }
 *                   displayName: { type: string }
 *                   sharedAt: { type: string }
 *                   receivedAt: { type: string }
 *                   photoCount: { type: integer }
 *                   bytes: { type: integer }
 *                   poiCategories: { type: array, items: { type: object } }
 */
sharedSkiesRouter.get('/api/shared-skies', async (_req, res) => {
  try {
    res.json(await sharedSkies.list());
  } catch (err) {
    fail(res, 'shared_sky_list_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies/{id}/photos:
 *   get:
 *     summary: The photos of a visited sky
 *     description: The same shape as `GET /api/photos`, each with `sharedSkyId`. They are read-only.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The photos, in the sender's order
 *       404:
 *         description: Unknown sky (`SHARED_SKY_NOT_FOUND`)
 */
sharedSkiesRouter.get('/api/shared-skies/:id/photos', async (req, res) => {
  try {
    res.json(await sharedSkies.listPhotos(req.params.id));
  } catch (err) {
    fail(res, 'shared_sky_list_failure', err);
  }
});

/**
 * @swagger
 * /api/shared-skies/{id}:
 *   delete:
 *     summary: Delete a visited sky and its files
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bytesFreed: { type: integer }
 *       404:
 *         description: Unknown sky (`SHARED_SKY_NOT_FOUND`)
 */
sharedSkiesRouter.delete('/api/shared-skies/:id', async (req, res) => {
  try {
    res.json(await sharedSkies.remove(req.params.id));
  } catch (err) {
    fail(res, 'shared_sky_delete_failure', err);
  }
});
