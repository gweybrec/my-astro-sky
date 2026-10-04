import express from 'express';
import sharp from 'sharp';
import path from 'path';
import { upload } from './shared.js';
import { extractWCS } from '../wcs-reader.js';
import {
  submitJob,
  getJobStatus,
  isConfigured as isAstrometryConfigured,
  listUserSubmissions,
  reuseSubmission,
} from '../astrometry.js';

export const novaSolveRouter = express.Router();

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
novaSolveRouter.post('/api/solve-plate', upload.single('photo'), async (req, res) => {
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
novaSolveRouter.get('/api/solve-plate/:id', (req, res) => {
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
novaSolveRouter.get('/api/astrometry/submissions', async (req, res) => {
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
novaSolveRouter.post('/api/astrometry/reuse', upload.single('photo'), async (req, res) => {
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
