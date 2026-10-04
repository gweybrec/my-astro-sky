import express from 'express';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../server-paths.js';
import {
  ALLOWED_PHOTO_EXTENSIONS,
  isElectron,
  UPLOAD_LIMIT,
  checkRateLimit,
  upload,
  sanitizeIntegrationRows,
  type IntegrationRow,
} from './shared.js';
import {
  createPhoto,
  getAllPhotos,
  getPhotoById,
  deletePhoto,
  getPhotoFilename,
  updatePhotoManualPlacement,
  updatePhotoMetadata,
  updatePhotoDrawOrder,
  deleteAllPhotoMetadata as deleteAllPhotoMetadataDB,
  sanitizePois,
  sanitizeCaptureDetails,
  type PointOfInterestInput,
} from '../db.js';

export const photosRouter = express.Router();

const MAX_CORRESPONDENCES = 100;

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

    // Validate file extension
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_PHOTO_EXTENSIONS.has(fileExt)) {
      res
        .status(400)
        .json({ error: `Extension non autorisée : ${fileExt}`, code: 'INVALID_EXTENSION' });
      return;
    }

    const corrJson = req.body?.correspondences;
    if (!corrJson) {
      res
        .status(400)
        .json({ error: 'Correspondances manquantes', code: 'MISSING_CORRESPONDENCES' });
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
      res
        .status(400)
        .json({ error: 'Au moins 2 correspondances requises', code: 'MIN_CORRESPONDENCES' });
      return;
    }
    if (correspondences.length > MAX_CORRESPONDENCES) {
      res.status(400).json({
        error: `Trop de correspondances (max ${MAX_CORRESPONDENCES})`,
        code: 'MAX_CORRESPONDENCES',
      });
      return;
    }

    // Validate each correspondence field
    for (const c of correspondences) {
      if (!Number.isInteger(c.pointIndex) || c.pointIndex < 0) {
        res.status(400).json({
          error: 'pointIndex invalide (entier >= 0 attendu)',
          code: 'INVALID_POINT_INDEX',
        });
        return;
      }
      if (typeof c.photoX !== 'number' || !Number.isFinite(c.photoX) || c.photoX < 0) {
        res
          .status(400)
          .json({ error: 'photoX invalide (nombre positif attendu)', code: 'INVALID_PHOTO_X' });
        return;
      }
      if (typeof c.photoY !== 'number' || !Number.isFinite(c.photoY) || c.photoY < 0) {
        res
          .status(400)
          .json({ error: 'photoY invalide (nombre positif attendu)', code: 'INVALID_PHOTO_Y' });
        return;
      }
      // starHip=0 is allowed when starRa/starDec are provided (direct RA/Dec input)
      if (c.starHip === 0) {
        if (
          typeof c.starRa !== 'number' ||
          !Number.isFinite(c.starRa) ||
          typeof c.starDec !== 'number' ||
          !Number.isFinite(c.starDec)
        ) {
          res
            .status(400)
            .json({ error: 'starRa/starDec requis quand starHip=0', code: 'INVALID_STAR_HIP' });
          return;
        }
      } else if (!Number.isInteger(c.starHip) || c.starHip <= 0) {
        res
          .status(400)
          .json({ error: 'starHip invalide (entier positif attendu)', code: 'INVALID_STAR_HIP' });
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
    const needsSwap =
      metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
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
      res.status(400).json({
        error: "Impossible de traiter l'image (format non supporté ou fichier corrompu)",
        code: 'INVALID_IMAGE',
      });
      return;
    }

    console.log(
      '[Upload] Scaling correspondences from browser',
      browserWidth,
      'x',
      browserHeight,
      'to final',
      newWidth,
      'x',
      newHeight,
    );

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
        console.log(
          '[Upload] Scaling projPerPx from',
          placement.projPerPx,
          'by 1/',
          avgScale.toFixed(4),
          '=',
          scaledPlacement.projPerPx,
        );
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
    try {
      dsoIds = JSON.parse(req.body?.dsoIds || '[]');
      if (!Array.isArray(dsoIds)) dsoIds = [];
    } catch {
      dsoIds = [];
    }
    try {
      labels = JSON.parse(req.body?.labels || '[]');
      if (!Array.isArray(labels)) labels = [];
    } catch {
      labels = [];
    }
    let pointsOfInterest: PointOfInterestInput[] = [];
    try {
      pointsOfInterest = sanitizePois(JSON.parse(req.body?.pointsOfInterest || '[]'));
    } catch {
      pointsOfInterest = [];
    }
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
    let captureDetails: Record<string, number | string> = {};
    try {
      captureDetails = sanitizeCaptureDetails(JSON.parse(req.body?.captureDetails || '{}'));
    } catch {
      captureDetails = {};
    }
    const gearSetupId =
      typeof req.body?.gearSetupId === 'string' && req.body.gearSetupId.trim()
        ? req.body.gearSetupId.trim().slice(0, 64)
        : null;

    // Allow caller to override the display name
    const displayName =
      typeof req.body?.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim().slice(0, 255)
        : file.originalname;

    // Generate low-res thumbnail (400px on longest side, JPEG q75)
    const THUMB_SIZE = 400;
    const thumbFilename = `${id}_thumb.jpg`;
    try {
      const thumbScale = Math.min(1, THUMB_SIZE / Math.max(newWidth, newHeight));
      const thumbW = Math.max(1, Math.round(newWidth * thumbScale));
      const thumbH = Math.max(1, Math.round(newHeight * thumbScale));
      await sharp(path.join(UPLOADS_DIR, filename))
        .resize(thumbW, thumbH)
        .jpeg({ quality: 75 })
        .toFile(path.join(UPLOADS_DIR, thumbFilename));
    } catch (thumbErr) {
      console.warn('[Upload] Thumbnail generation failed:', thumbErr);
    }

    // Store in database
    createPhoto(
      id,
      filename,
      displayName,
      newWidth,
      newHeight,
      scaledCorrespondences,
      scaledManualPlacement,
      dsoIds,
      labels,
      notes,
      integrations,
      thumbFilename,
      observationDate,
      pointsOfInterest,
      captureDetails,
      gearSetupId,
    );

    // Return the freshly persisted row through the same serializer GET /api/photos
    // uses, so the client's in-memory photo matches what a reload would fetch and no
    // metadata field can be silently dropped from the response.
    res.json(getPhotoById(id));
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
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
photosRouter.get('/api/photos', (_req, res) => {
  try {
    const photos = getAllPhotos();
    const photosWithSize = photos.map((p) => {
      const filePath = path.join(UPLOADS_DIR, p.filename);
      let fileSize: number | null = null;
      try {
        fileSize = fs.statSync(filePath).size;
      } catch {
        /* file missing */
      }
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
photosRouter.patch('/api/photos/order', (req, res) => {
  try {
    const { photoIds } = req.body as { photoIds?: unknown };

    if (
      !Array.isArray(photoIds) ||
      photoIds.some((id) => typeof id !== 'string' || id.length === 0)
    ) {
      res.status(400).json({
        error: 'photoIds must be a non-empty array of strings',
        code: 'INVALID_PHOTO_ORDER',
      });
      return;
    }

    const unique = new Set(photoIds);
    if (unique.size !== photoIds.length) {
      res.status(400).json({ error: 'photoIds contains duplicates', code: 'INVALID_PHOTO_ORDER' });
      return;
    }

    const allPhotos = getAllPhotos();
    const allIds = new Set(allPhotos.map((p) => p.id));
    if (photoIds.length !== allIds.size || photoIds.some((id) => !allIds.has(id))) {
      res.status(400).json({
        error: 'photoIds must include all existing photos exactly once',
        code: 'INVALID_PHOTO_ORDER',
      });
      return;
    }

    const ok = updatePhotoDrawOrder(photoIds);
    if (!ok && photoIds.length > 0) {
      res
        .status(500)
        .json({ error: 'Failed to persist photo order', code: 'PHOTO_ORDER_UPDATE_FAILED' });
      return;
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
photosRouter.delete('/api/photos/:id', (req, res) => {
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
photosRouter.delete('/api/photos', (req, res) => {
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
photosRouter.delete('/api/photo-metadata', (_req, res) => {
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
photosRouter.patch('/api/photos/:id/manual-placement', (req, res) => {
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
photosRouter.patch('/api/photos/:id/metadata', (req, res) => {
  try {
    const { id } = req.params;

    if (!getPhotoFilename(id)) {
      res.status(404).json({ error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' });
      return;
    }

    let {
      dsoIds,
      labels,
      integrations,
      notes,
      originalName,
      observationDate,
      pointsOfInterest,
      captureDetails,
      gearSetupId,
    } = req.body;
    if (!Array.isArray(dsoIds)) dsoIds = [];
    if (!Array.isArray(labels)) labels = [];
    pointsOfInterest = sanitizePois(pointsOfInterest);
    integrations = sanitizeIntegrationRows(integrations);
    captureDetails = sanitizeCaptureDetails(captureDetails);
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
    const resolvedSetupId: string | null =
      typeof gearSetupId === 'string' && gearSetupId.trim()
        ? gearSetupId.trim().slice(0, 64)
        : null;

    updatePhotoMetadata(
      id,
      dsoIds,
      labels,
      notes,
      resolvedOriginalName,
      integrations,
      resolvedObsDate,
      pointsOfInterest,
      captureDetails,
      resolvedSetupId,
    );
    res.json({
      ok: true,
      ...(resolvedOriginalName !== undefined ? { originalName: resolvedOriginalName } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
