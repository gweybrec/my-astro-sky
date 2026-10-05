import express from 'express';
import path from 'path';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { SolvedCaptureMetadata } from '@myastrosky/core/domain/solved-import';
import { isElectron, UPLOAD_LIMIT, checkRateLimit, uploadWCS, uploadRaw } from './shared.js';
import { solvedImport } from '../services.js';
import { msg } from '../messages.js';
import type { ServerLang } from '../messages.js';
import { logServerError } from '../logger.js';

/** The capture fields of a result, in the order the API has always sent them. */
const captureFields = (r: SolvedCaptureMetadata): SolvedCaptureMetadata => ({
  ...(r.dateObs ? { dateObs: r.dateObs } : {}),
  ...(r.expTime !== undefined ? { expTime: r.expTime } : {}),
  ...(r.stackCnt !== undefined ? { stackCnt: r.stackCnt } : {}),
  ...(r.filter ? { filter: r.filter } : {}),
  ...(r.captureDetails ? { captureDetails: r.captureDetails } : {}),
});

export const solvedImportRouter = express.Router();

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
 *                 filter:
 *                   type: string
 *                   description: FILTER header value, present when available
 *                 captureDetails:
 *                   type: object
 *                   description: Parsed capture fields (gain, offset, iso, ccdTemp, setTemp, binning) keyed by field id, present when available
 *       400:
 *         description: Missing file, unsupported format, or no WCS data found
 *       500:
 *         description: Server error
 */
// --- WCS solve route ---
solvedImportRouter.post('/api/solve-wcs', uploadWCS.single('photo'), async (req, res) => {
  try {
    // Get language from request (default to 'en')
    const lang = (
      req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
    ) as ServerLang;

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: msg.api.noFile(lang), code: 'NO_FILE' });
      return;
    }

    let result;
    try {
      result = await solvedImport.solveWcs({
        fileName: file.originalname,
        bytes: file.buffer,
        targetWidth: parseInt(req.body.targetWidth || '0', 10),
        targetHeight: parseInt(req.body.targetHeight || '0', 10),
      });
    } catch (err) {
      if (isDomainError(err) && err.code === 'UNSUPPORTED_FORMAT') {
        res.status(400).json({
          success: false,
          error: msg.api.unsupportedWcsFormat(lang),
          code: 'UNSUPPORTED_FORMAT',
        });
        return;
      }
      throw err;
    }

    if (!result.success) {
      const error = {
        NO_WCS_DATA: msg.api.noWcsData(lang),
        NO_IMAGE_DIMENSIONS: msg.api.noImageDimensions(lang),
        NOT_ENOUGH_CATALOG_STARS: msg.api.notEnoughCatalogStars(lang),
      }[result.code];
      res.json({ success: false, error, code: result.code });
      return;
    }

    if (result.dimensionWarning) {
      const w = result.dimensionWarning;
      console.log(
        `[WCS] Rescaled correspondences: source ${w.sourceW}x${w.sourceH} → target ${w.targetW}x${w.targetH} (aspectMismatch=${w.aspectMismatch})`,
      );
    }

    res.json({
      success: true,
      correspondences: result.correspondences,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      ...(result.dimensionWarning ? { dimensionWarning: result.dimensionWarning } : {}),
      ...captureFields(result),
    });
  } catch (err: any) {
    console.error('WCS solve error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @swagger
 * /api/photos/convert:
 *   post:
 *     summary: Convert a raw astro image (TIFF/FITS) to a PNG, plus any WCS/capture metadata
 *     description: >
 *       The raw file is never stored. It is decoded server-side with a faithful linear
 *       mapping (no histogram stretch) into an 8-bit PNG, returned to the caller alongside
 *       any WCS-derived star correspondences and capture metadata found in its FITS header
 *       — in the same shape as `/api/solve-wcs` — so a plate-solved raw file can be placed
 *       on the sky map without running a solver.
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Converted successfully (success:false in the body means no WCS was found — not an error; the PNG is still returned)
 *       400:
 *         description: Missing file or unsupported/corrupt raw format
 *       500:
 *         description: Server error
 */
solvedImportRouter.post('/api/photos/convert', uploadRaw.single('photo'), async (req, res) => {
  try {
    const lang = (
      req.body.lang === 'fr' || req.body.lang === 'en' ? req.body.lang : 'en'
    ) as ServerLang;

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
      res.status(400).json({ success: false, error: msg.api.noFile(lang), code: 'NO_FILE' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    let result;
    try {
      result = await solvedImport.convert({ fileName: file.originalname, bytes: file.buffer });
    } catch (err) {
      if (isDomainError(err) && err.code === 'UNSUPPORTED_FORMAT') {
        res.status(400).json({
          success: false,
          error: msg.api.unsupportedRawFormat(lang, ext),
          code: 'UNSUPPORTED_FORMAT',
        });
        return;
      }
      if (isDomainError(err) && err.code === 'UNSUPPORTED_RAW_FORMAT') {
        logServerError('raw_convert_unsupported', err, { ext });
        res.status(400).json({
          success: false,
          error: msg.api.rawDecodeFailed(lang, err.message),
          code: 'UNSUPPORTED_RAW_FORMAT',
        });
        return;
      }
      throw err;
    }

    res.json({
      success: result.success,
      ...(result.success
        ? { correspondences: result.correspondences }
        : { error: msg.api.noWcsData(lang), code: 'NO_WCS_DATA' }),
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      width: result.width,
      height: result.height,
      pngBase64: Buffer.from(result.png).toString('base64'),
      ...captureFields(result),
    });
  } catch (err: any) {
    logServerError('raw_convert_failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
