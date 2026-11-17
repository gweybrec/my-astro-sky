import express from 'express';
import fs from 'fs';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { NovaSolveHints } from '@myastrosky/core/domain/solve';
import { removeUpload, upload, uploadSolve } from './shared.js';
import { novaSolve } from '../services.js';
import { sendError } from './http-errors.js';
import { logServerError } from '../logger.js';

/**
 * The upload on disk, read only as it is needed: astrometry.net gets it streamed from the file, and the service
 * reads only the start of a FITS file for its size. A stack of several hundred megabytes never sits in memory.
 */
function uploadedFile(filePath: string): Promise<Blob> {
  return fs.openAsBlob(filePath, { type: 'application/octet-stream' });
}

export const novaSolveRouter = express.Router();

type Lang = 'fr' | 'en';
const langOf = (body: any): Lang => (body.lang === 'fr' || body.lang === 'en' ? body.lang : 'en');

/** The 400 the routes send for a rule of the service they report with a code and a message in the client's language. */
function sendRule(res: express.Response, err: unknown, messages: Record<string, string>): boolean {
  if (isDomainError(err) && err.code && err.code in messages) {
    res.status(400).json({ error: messages[err.code], code: err.code });
    return true;
  }
  return false;
}

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
novaSolveRouter.post('/api/solve-plate', uploadSolve.single('photo'), async (req, res) => {
  try {
    // Get language from request (default to 'en')
    const lang = langOf(req.body);

    if (!(await novaSolve.isConfigured())) {
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

    // Parse optional hints from request body
    const hints: NovaSolveHints = {};
    if (req.body.ra !== undefined) hints.ra = parseFloat(req.body.ra);
    if (req.body.dec !== undefined) hints.dec = parseFloat(req.body.dec);
    if (req.body.radius !== undefined) hints.radius = parseFloat(req.body.radius);
    if (req.body.scale_lower !== undefined) hints.scale_lower = parseFloat(req.body.scale_lower);
    if (req.body.scale_upper !== undefined) hints.scale_upper = parseFloat(req.body.scale_upper);

    let jobId: string;
    try {
      jobId = await novaSolve.submit(
        { fileName: file.originalname, bytes: await uploadedFile(file.path) },
        Object.keys(hints).length > 0 ? hints : undefined,
      );
    } catch (err) {
      if (
        sendRule(res, err, {
          CANNOT_DETERMINE_DIMENSIONS:
            lang === 'fr'
              ? "Impossible de déterminer les dimensions de l'image"
              : 'Cannot determine image dimensions',
        })
      ) {
        return;
      }
      throw err;
    }
    res.json({ jobId });
  } catch (err: any) {
    console.error('Plate solve submit error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // `submit` returns once the upload to astrometry.net is over: the file on disk is no longer needed.
    await removeUpload(req.file);
  }
});

/**
 * @swagger
 * /api/solve-plate/resume:
 *   post:
 *     summary: Follow again an Astrometry.net submission sent earlier
 *     description: Starts a new local job that polls the given submission (the jobs are lost when the app restarts). The photo gives the picture's size; nothing is uploaded to Astrometry.net.
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *               submissionId:
 *                 type: integer
 *               fits:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: The picture sent was a FITS file (rows count from the bottom), though the photo given is not; by default its own name tells
 *     responses:
 *       200:
 *         description: The new local job id
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *       400:
 *         description: No API key, no file, an invalid submission id or a picture of unknown size
 *       500:
 *         description: Server error
 */
novaSolveRouter.post('/api/solve-plate/resume', uploadSolve.single('photo'), async (req, res) => {
  try {
    const lang = langOf(req.body);
    const notConfigured =
      lang === 'fr' ? 'ASTROMETRY_API_KEY non configurée' : 'ASTROMETRY_API_KEY not configured';

    const file = req.file;
    if (!file) {
      // Without a file there is no service call to refuse for a missing key, and the key comes first.
      if (!(await novaSolve.isConfigured())) {
        res.status(400).json({ error: notConfigured, code: 'ASTROMETRY_NOT_CONFIGURED' });
        return;
      }
      res.status(400).json({
        error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided',
        code: 'NO_FILE',
      });
      return;
    }

    let jobId: string;
    try {
      const fits = req.body.fits === 'true' ? true : req.body.fits === 'false' ? false : undefined;
      jobId = await novaSolve.resume(
        { fileName: file.originalname, bytes: await uploadedFile(file.path) },
        Number(req.body.submissionId),
        fits === undefined ? undefined : { fits },
      );
    } catch (err) {
      if (
        sendRule(res, err, {
          ASTROMETRY_NOT_CONFIGURED: notConfigured,
          INVALID_SUBMISSION_ID:
            lang === 'fr' ? 'Identifiant de soumission invalide' : 'Invalid submission ID',
          CANNOT_DETERMINE_DIMENSIONS:
            lang === 'fr'
              ? "Impossible de déterminer les dimensions de l'image"
              : 'Cannot determine image dimensions',
        })
      ) {
        return;
      }
      throw err;
    }
    res.json({ jobId });
  } catch (err) {
    console.error('Plate solve resume error:', err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    await removeUpload(req.file);
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
 *                 submissionId:
 *                   type: integer
 *                   description: The Astrometry.net submission, once the picture is sent (for /api/solve-plate/resume)
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
novaSolveRouter.get('/api/solve-plate/:id', async (req, res) => {
  try {
    res.json(await novaSolve.getJob(req.params.id));
  } catch (err) {
    if (isDomainError(err) && err.kind === 'notFound') {
      res.status(404).json(err.body ?? { error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @swagger
 * /api/astrometry/submissions:
 *   get:
 *     summary: One page of the user's Astrometry.net submissions, most recent first
 *     description: Only the submissions of the page are looked up on Astrometry.net.
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: How many of the most recent submissions to skip
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           maximum: 20
 *         description: How many submissions the page holds
 *     responses:
 *       200:
 *         description: The page and the number of submissions in all
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 submissions:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       400:
 *         description: No API key (ASTROMETRY_NOT_CONFIGURED)
 *       429:
 *         description: Astrometry.net refuses for too many requests (ASTROMETRY_RATE_LIMITED)
 *       500:
 *         description: Server error
 */
// --- List user's astrometry.net submissions ---
novaSolveRouter.get('/api/astrometry/submissions', async (req, res) => {
  try {
    const offset = req.query.offset === undefined ? undefined : Number(req.query.offset);
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    res.json(await novaSolve.listSubmissions({ offset, limit }));
  } catch (err: any) {
    if (sendRule(res, err, { ASTROMETRY_NOT_CONFIGURED: 'ASTROMETRY_API_KEY not configured' })) {
      return;
    }
    logServerError('astrometry_list_submissions_failed', err);
    sendError(res, err);
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
 *       429:
 *         description: Astrometry.net refuses for too many requests (ASTROMETRY_RATE_LIMITED)
 */
// --- Reuse existing astrometry.net submission ---
novaSolveRouter.post('/api/astrometry/reuse', upload.single('photo'), async (req, res) => {
  try {
    const lang = langOf(req.body);

    const notConfigured =
      lang === 'fr' ? 'ASTROMETRY_API_KEY non configurée' : 'ASTROMETRY_API_KEY not configured';

    const file = req.file;
    if (!file) {
      // Without a file there is no service call to refuse for a missing key, and the key comes first.
      if (!(await novaSolve.isConfigured())) {
        res.status(400).json({ error: notConfigured, code: 'ASTROMETRY_NOT_CONFIGURED' });
        return;
      }
      res.status(400).json({
        error: lang === 'fr' ? 'Aucun fichier fourni' : 'No file provided',
        code: 'NO_FILE',
      });
      return;
    }

    let result;
    try {
      result = await novaSolve.reuse(
        { fileName: file.originalname, bytes: file.buffer },
        parseInt(req.body.jobId, 10),
      );
    } catch (err) {
      if (
        sendRule(res, err, {
          ASTROMETRY_NOT_CONFIGURED: notConfigured,
          INVALID_JOB_ID: lang === 'fr' ? 'Job ID invalide' : 'Invalid job ID',
          CANNOT_DETERMINE_DIMENSIONS:
            lang === 'fr'
              ? 'Impossible de déterminer les dimensions'
              : 'Cannot determine image dimensions',
        })
      ) {
        return;
      }
      throw err;
    }

    if (result.success) {
      res.json({ success: true, correspondences: result.correspondences });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (err: any) {
    logServerError('astrometry_reuse_failed', err);
    sendError(res, err);
  }
});
