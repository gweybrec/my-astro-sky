import express from 'express';
import path from 'path';
import sharp from 'sharp';
import type { ExportRequest, ImportOptions } from '@myastrosky/core/domain/backup';
import { uploadBundle } from './shared.js';
import { backup as backupService } from '../services.js';
import { createZipResponseWriter, openZipBundle } from '../bundle-zip.js';
import { isDomainError } from '@myastrosky/core/domain/errors';
import { sendError } from './http-errors.js';

export const backupRouter = express.Router();

/** An error that is not a `DomainError` becomes a 500 with its message, as these routes always did. */
function fail(res: express.Response, err: unknown): void {
  if (isDomainError(err)) sendError(res, err);
  else res.status(500).json({ error: (err as Error)?.message ?? String(err) });
}

/**
 * @swagger
 * /api/export:
 *   post:
 *     summary: Export photos as ZIP or metadata JSON
 *     responses:
 *       200:
 *         description: Export generated successfully
 */
// Export photos as ZIP (full) or JSON (metadata only)
// POST body: { mode: 'full' | 'metadata', ids?: string[] }
// New shape:  { options: { includeImages?, includeMetadata?, includeDsoOverrides? }, ids? }
backupRouter.post('/api/export', async (req, res) => {
  let zip: ReturnType<typeof createZipResponseWriter> | null = null;
  try {
    const body = req.body as ExportRequest & { mode?: string };

    // Support legacy mode='metadata' for backward compat with backup button
    const legacyMetadataOnly = body.mode === 'metadata';
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '-');

    if (legacyMetadataOnly) {
      const selected = await backupService.selectPhotos(body.ids);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.json"`);
      res.json(selected);
      return;
    }

    // Always produce a ZIP, streamed to the response; the headers go out with the first file.
    zip = createZipResponseWriter(res, () => {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.zip"`);
    });
    await backupService.exportTo(zip, {
      options: body.options,
      ids: body.ids,
      shortcuts: body.shortcuts,
    });
    await zip.finalize();
  } catch (err: any) {
    zip?.abort();
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/import/preview:
 *   post:
 *     summary: Preview import bundle without writing data
 *     consumes:
 *       - multipart/form-data
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
 *                 description: The .zip or .json bundle to inspect
 *     responses:
 *       200:
 *         description: >
 *           Import preview returned successfully. Each entry of `plans` carries `setupId`, the
 *           setup id stored in the bundle (null when none). Each entry of `setups` carries
 *           `conflict` (`none`, `identical` or `different`, against the local setup with the same
 *           id, else the same name) and, unless `none`, `localId`, that local setup's id.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       exists: { type: boolean }
 *                       setupId: { type: string, nullable: true }
 *                 setups:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       exists: { type: boolean }
 *                       conflict: { type: string, enum: [none, identical, different] }
 *                       localId: { type: string }
 *       400:
 *         description: No file, unsupported format or invalid manifest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
// Import preview (dry-run) — inspect ZIP contents and report what can be imported
backupRouter.post('/api/import/preview', uploadBundle.single('bundle'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      res.json(await backupService.preview(await openZipBundle(file.buffer)));
    } else if (ext === '.json') {
      res.json(backupService.previewPhotoList(JSON.parse(file.buffer.toString('utf8'))));
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }
  } catch (err: any) {
    fail(res, err);
  }
});

/**
 * @swagger
 * /api/import:
 *   post:
 *     summary: Import photos and optional DSO overrides from a bundle
 *     description: >
 *       A ticked plan brings its setup (and the custom gear that setup uses, when the bundle has
 *       them and this machine does not). A setup identical to a local one is not imported and the
 *       plans are pointed at the local setup. A setup that differs from a local one follows
 *       `setupConflicts`; with no choice sent it is replaced when ticked and skipped when only a
 *       plan pulled it in.
 *     consumes:
 *       - multipart/form-data
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
 *                 description: The .zip or .json bundle to import
 *               importMetadata: { type: string, description: "'1' to import photo metadata" }
 *               importDsoOverrides: { type: string, description: "'1' to import DSO overrides" }
 *               importPoiCategories: { type: string, description: "'1' to import POI categories" }
 *               importSkyRegions: { type: string, description: "'1' to import sky regions" }
 *               selectedImages: { type: string, description: "JSON string[] of image file names" }
 *               selectedPlans: { type: string, description: "JSON string[] of plan ids" }
 *               selectedSetups: { type: string, description: "JSON string[] of setup ids" }
 *               selectedGear: { type: string, description: "JSON string[] of custom gear ids" }
 *               setupConflicts:
 *                 type: string
 *                 description: >
 *                   JSON object mapping a bundle setup id to `replace`, `keepBoth` (imported under
 *                   a new id, name followed by " (import)") or `skip`. Only read for setups whose
 *                   content differs from a local one.
 *     responses:
 *       200:
 *         description: Import completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 imported: { type: integer }
 *                 skipped: { type: integer }
 *                 dsoOverridesImported: { type: integer }
 *                 failed:
 *                   type: array
 *                   description: Items that could not be restored (the others were imported)
 *                   items:
 *                     type: object
 *                     properties:
 *                       kind: { type: string, enum: [plan, setup, gear, photo] }
 *                       name: { type: string }
 *       400:
 *         description: No file, unsupported format, invalid ZIP entry path or invalid manifest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       500:
 *         description: Server error
 */
// Import photos from ZIP (full) or JSON (metadata only)
// Form fields: bundle (file), importMetadata, importDsoOverrides, selectedImages,
//              selectedPlans, selectedSetups, selectedGear (all JSON string[]),
//              setupConflicts (JSON object: bundle setup id -> replace | keepBoth | skip)
backupRouter.post('/api/import', uploadBundle.single('bundle'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Aucun fichier fourni' });
      return;
    }

    // An absent field means "import none of that category"; a list means "import only these ids".
    const parseIdList = (raw: unknown): string[] =>
      typeof raw === 'string' ? (JSON.parse(raw) as string[]) : [];
    const selection: ImportOptions = {
      importMetadata: req.body?.importMetadata === '1',
      importDsoOverrides: req.body?.importDsoOverrides === '1',
      importPoiCategories: req.body?.importPoiCategories === '1',
      importSkyRegions: req.body?.importSkyRegions === '1',
      // null means "no image filter" (metadata-only import)
      selectedImages: req.body?.selectedImages
        ? (JSON.parse(req.body.selectedImages) as string[])
        : null,
      selectedPlans: parseIdList(req.body?.selectedPlans),
      selectedSetups: parseIdList(req.body?.selectedSetups),
      selectedGear: parseIdList(req.body?.selectedGear),
      // Choice per bundle setup id for a setup whose content differs from a local one.
      setupConflicts:
        typeof req.body?.setupConflicts === 'string' ? JSON.parse(req.body.setupConflicts) : {},
    };

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      const reader = await openZipBundle(file.buffer);
      // Flush libvips handle cache before writing to avoid Windows sharing violations
      // when re-importing the same files that sharp processed in a previous request.
      sharp.cache(false);
      res.json(await backupService.importFrom(reader, selection));
    } else if (ext === '.json') {
      res.json(
        await backupService.importPhotoList(JSON.parse(file.buffer.toString('utf8')), selection),
      );
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }
  } catch (err: any) {
    fail(res, err);
  }
});
