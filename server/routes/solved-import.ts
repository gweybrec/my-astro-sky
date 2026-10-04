import express from 'express';
import sharp from 'sharp';
import path from 'path';
import {
  ALLOWED_WCS_EXTENSIONS,
  isElectron,
  UPLOAD_LIMIT,
  checkRateLimit,
  uploadWCS,
  uploadRaw,
} from './shared.js';
import { extractWCS, wcsToCorrespondences, loadServerCatalog } from '../wcs-reader.js';
import {
  decodeRawAstroImage,
  UnsupportedRawFormatError,
  UnsupportedTiffError,
  UnsupportedFitsError,
} from '../raw-decode/index.js';
import { msg } from '../messages.js';
import type { ServerLang } from '../messages.js';
import { logServerError } from '../logger.js';

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

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_WCS_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedWcsFormat(lang),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    const wcs = extractWCS(file.buffer, ext);
    if (!wcs) {
      res.json({ success: false, error: msg.api.noWcsData(lang), code: 'NO_WCS_DATA' });
      return;
    }

    // Get image dimensions from NAXIS header keywords
    let imageWidth = wcs.NAXIS1;
    let imageHeight = wcs.NAXIS2;

    // For TIFF, try to get dimensions from sharp if NAXIS not in header
    if ((ext === '.tif' || ext === '.tiff') && (!imageWidth || !imageHeight)) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        imageWidth = metadata.width || imageWidth;
        imageHeight = metadata.height || imageHeight;
      } catch {
        // Ignore sharp errors
      }
    }

    if (!imageWidth || !imageHeight) {
      res.json({
        success: false,
        error: msg.api.noImageDimensions(lang),
        code: 'NO_IMAGE_DIMENSIONS',
      });
      return;
    }

    loadServerCatalog();
    // Standard FITS files from PixInsight/Siril use FITS Y convention (Y=1 = bottom row,
    // Y increases upward), which is opposite to display/screen convention (Y=0 = top row).
    // Pass fitsYConvention=true so pixel positions are correctly flipped when mapping
    // catalog stars into the image's display coordinate space.
    const correspondences = wcsToCorrespondences(wcs, imageWidth, imageHeight, true);

    if (correspondences.length < 3) {
      res.json({
        success: false,
        error: msg.api.notEnoughCatalogStars(lang),
        code: 'NOT_ENOUGH_CATALOG_STARS',
      });
      return;
    }

    // Rescale correspondences to target (display image) dimensions if provided
    const targetWidth = parseInt(req.body.targetWidth || '0', 10);
    const targetHeight = parseInt(req.body.targetHeight || '0', 10);

    let finalCorrespondences = correspondences;
    let dimensionWarning:
      | {
          sourceW: number;
          sourceH: number;
          targetW: number;
          targetH: number;
          aspectMismatch: boolean;
        }
      | undefined;

    if (
      targetWidth > 0 &&
      targetHeight > 0 &&
      (targetWidth !== imageWidth || targetHeight !== imageHeight)
    ) {
      const sourceAspect = imageWidth / imageHeight;
      const targetAspect = targetWidth / targetHeight;
      const aspectDiff = Math.abs(sourceAspect - targetAspect) / sourceAspect;
      const aspectMismatch = aspectDiff > 0.01; // >1% aspect ratio difference

      dimensionWarning = {
        sourceW: imageWidth,
        sourceH: imageHeight,
        targetW: targetWidth,
        targetH: targetHeight,
        aspectMismatch,
      };

      const scaleX = targetWidth / imageWidth;
      const scaleY = targetHeight / imageHeight;
      finalCorrespondences = correspondences.map((c) => ({
        ...c,
        photoX: c.photoX * scaleX,
        photoY: c.photoY * scaleY,
      }));
      console.log(
        `[WCS] Rescaled correspondences: source ${imageWidth}x${imageHeight} → target ${targetWidth}x${targetHeight} (aspectMismatch=${aspectMismatch})`,
      );
    }

    res.json({
      success: true,
      correspondences: finalCorrespondences,
      sourceWidth: imageWidth,
      sourceHeight: imageHeight,
      ...(dimensionWarning ? { dimensionWarning } : {}),
      ...(wcs.dateObs ? { dateObs: wcs.dateObs } : {}),
      ...(wcs.expTime !== undefined ? { expTime: wcs.expTime } : {}),
      ...(wcs.stackCnt !== undefined ? { stackCnt: wcs.stackCnt } : {}),
      ...(wcs.filter ? { filter: wcs.filter } : {}),
      ...(wcs.captureDetails ? { captureDetails: wcs.captureDetails } : {}),
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
    if (!ALLOWED_WCS_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: msg.api.unsupportedRawFormat(lang, ext),
        code: 'UNSUPPORTED_FORMAT',
      });
      return;
    }

    let decoded: Awaited<ReturnType<typeof decodeRawAstroImage>>;
    try {
      decoded = await decodeRawAstroImage(file.buffer, ext);
    } catch (err) {
      if (
        err instanceof UnsupportedRawFormatError ||
        err instanceof UnsupportedTiffError ||
        err instanceof UnsupportedFitsError
      ) {
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

    // WCS + capture metadata, exactly like /api/solve-wcs — no rescale is ever needed
    // here since the PNG has the raw file's own exact dimensions.
    const wcs = extractWCS(file.buffer, ext);
    let success = false;
    let correspondences: ReturnType<typeof wcsToCorrespondences> = [];
    if (wcs) {
      loadServerCatalog();
      correspondences = wcsToCorrespondences(wcs, decoded.width, decoded.height, true);
      success = correspondences.length >= 3;
    }

    res.json({
      success,
      ...(success ? { correspondences } : { error: msg.api.noWcsData(lang), code: 'NO_WCS_DATA' }),
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      width: decoded.width,
      height: decoded.height,
      pngBase64: decoded.png.toString('base64'),
      ...(wcs?.dateObs ? { dateObs: wcs.dateObs } : {}),
      ...(wcs?.expTime !== undefined ? { expTime: wcs.expTime } : {}),
      ...(wcs?.stackCnt !== undefined ? { stackCnt: wcs.stackCnt } : {}),
      ...(wcs?.filter ? { filter: wcs.filter } : {}),
      ...(wcs?.captureDetails ? { captureDetails: wcs.captureDetails } : {}),
    });
  } catch (err: any) {
    logServerError('raw_convert_failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
