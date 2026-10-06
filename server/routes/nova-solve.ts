import express from 'express';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { NovaSolveHints } from '@myastrosky/core/domain/solve';
import { upload } from './shared.js';
import { novaSolve } from '../services.js';

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
novaSolveRouter.post('/api/solve-plate', upload.single('photo'), async (req, res) => {
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
        { fileName: file.originalname, bytes: file.buffer },
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
 *     summary: List user's Astrometry.net submissions
 *     responses:
 *       200:
 *         description: Submissions returned successfully
 */
// --- List user's astrometry.net submissions ---
novaSolveRouter.get('/api/astrometry/submissions', async (req, res) => {
  try {
    if (!(await novaSolve.isConfigured())) {
      res
        .status(400)
        .json({ error: 'ASTROMETRY_API_KEY not configured', code: 'ASTROMETRY_NOT_CONFIGURED' });
      return;
    }

    const submissions = await novaSolve.listSubmissions();
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
    const lang = langOf(req.body);

    if (!(await novaSolve.isConfigured())) {
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

    let result;
    try {
      result = await novaSolve.reuse(
        { fileName: file.originalname, bytes: file.buffer },
        parseInt(req.body.jobId, 10),
      );
    } catch (err) {
      if (
        sendRule(res, err, {
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
    console.error('Reuse submission error:', err);
    res.status(500).json({ error: err.message });
  }
});
