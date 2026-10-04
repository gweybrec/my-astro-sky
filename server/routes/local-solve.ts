import express from 'express';
import sharp from 'sharp';
import path from 'path';
import { ALLOWED_PHOTO_EXTENSIONS, upload } from './shared.js';
import { solveWithASTAP } from '../astap.js';
import { solveWithSolveField } from '../solve-field.js';
import { createJob, getJob, updateJob, cancelJob } from '../solve-queue.js';
import { rawToBrowserCoords } from '../exif-utils.js';
import { msg } from '../messages.js';
import type { ServerLang } from '../messages.js';

export const localSolveRouter = express.Router();

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
localSolveRouter.post('/api/solve-astap', upload.single('photo'), async (req, res) => {
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
localSolveRouter.get('/api/solve-astap/:jobId', (req, res) => {
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
localSolveRouter.delete('/api/solve-astap/:jobId', (req, res) => {
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
localSolveRouter.post('/api/solve-field', upload.single('photo'), async (req, res) => {
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
localSolveRouter.get('/api/solve-field/:jobId', (req, res) => {
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
localSolveRouter.delete('/api/solve-field/:jobId', (req, res) => {
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
