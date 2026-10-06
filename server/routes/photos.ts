import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { PhotoMetadataChanges } from '@myastrosky/core/domain/photos';
import { isElectron, UPLOAD_LIMIT, checkRateLimit, upload } from './shared.js';
import { photos } from '../services.js';
import { sendError } from './http-errors.js';

export const photosRouter = express.Router();

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
photosRouter.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
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
      res.status(400).json({ error: 'Aucun fichier fourni', code: 'NO_FILE' });
      return;
    }

    const { photo, source, warnings } = await photos.upload(
      { name: file.originalname, bytes: file.buffer },
      req.body ?? {},
    );
    console.log('[Upload] File pixel dimensions:', source.width, 'x', source.height);
    console.log('[Upload] EXIF orientation:', source.orientation);
    console.log('[Upload] Browser showed dimensions:', photo.width, 'x', photo.height);
    for (const w of warnings) console.warn('[Upload] Thumbnail generation failed:', w.error);

    // Answer with the row as GET /api/photos returns it, so the client's in-memory photo matches what a
    // reload would fetch and no metadata field is silently dropped.
    res.json(photo);
  } catch (err) {
    if (!isDomainError(err)) console.error('Upload error:', err);
    sendError(res, err);
  }
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
photosRouter.get('/api/photos', async (_req, res) => {
  try {
    const photosWithSize = await photos.listWithSizes();
    res.json(photosWithSize);
  } catch (err) {
    sendError(res, err);
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
photosRouter.patch('/api/photos/order', async (req, res) => {
  try {
    const { photoIds } = req.body as { photoIds?: unknown };
    await photos.setOrder(photoIds as string[]);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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
photosRouter.delete('/api/photos/:id', async (req, res) => {
  try {
    await photos.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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
photosRouter.delete('/api/photos', async (req, res) => {
  try {
    const { ids } = req.body as { ids?: unknown };
    const deleted = await photos.removeMany(ids as string[]);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[DeleteAll] Bulk photo delete failed', err);
    sendError(res, err);
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
photosRouter.delete('/api/photo-metadata', async (_req, res) => {
  try {
    const deleted = await photos.removeAll();
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[DeleteAll] Photo metadata delete failed', err);
    sendError(res, err);
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
photosRouter.patch('/api/photos/:id/manual-placement', async (req, res) => {
  try {
    const { id } = req.params;
    const { manualPlacement } = req.body;
    await photos.setManualPlacement(id, manualPlacement);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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
 *               captureDetails:
 *                 type: object
 *                 description: Parsed capture fields (gain, offset, iso, ccdTemp, setTemp, binning) keyed by field id; unknown keys dropped
 *               gearSetupId:
 *                 type: string
 *                 description: Linked gear-setup id (null to unlink)
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
photosRouter.patch('/api/photos/:id/metadata', async (req, res) => {
  try {
    const { originalName } = await photos.updateMetadata(
      req.params.id,
      req.body as PhotoMetadataChanges,
    );
    res.json({ ok: true, ...(originalName !== undefined ? { originalName } : {}) });
  } catch (err) {
    sendError(res, err);
  }
});
