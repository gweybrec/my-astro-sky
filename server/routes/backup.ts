import express from 'express';
import type { CustomGearType } from '@myastrosky/core/domain/gear';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { thumbnailNameOf } from '@myastrosky/core/services/photos';
import { UPLOADS_DIR } from '../server-paths.js';
import { ALLOWED_PHOTO_EXTENSIONS, uploadBundle } from './shared.js';
import {
  dsoOverrides as dsoOverridesService,
  gear as gearService,
  photos as photosService,
  plans as plansService,
  poiCategories as poiCategoriesService,
  skyRegions as skyRegionsService,
} from '../services.js';
import { ZipArchive } from 'archiver';
import { createRequire } from 'module';
import {
  isValidZipEntryPath,
  parseManifestPhotos,
  inspectZipContents,
  buildZipPreviewResponse,
  idsToReplaceByName,
  parseBundleSetups,
  parseBundlePlanSetupIds,
  classifyBundleSetup,
  planSetupImportActions,
} from '../import-utils.js';

// unzipper is CommonJS-only and has no ESM export, so it can't be `import`ed under
// "type": "module" — createRequire is a permanent interop shim for it, unrelated to archiver.
const _require = createRequire(import.meta.url);
const unzipper = _require('unzipper') as typeof import('unzipper');

export const backupRouter = express.Router();

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
  try {
    const body = req.body as {
      mode?: string;
      options?: {
        includeImages?: boolean;
        includeMetadata?: boolean;
        includeDsoOverrides?: boolean;
        includeCustomGear?: boolean;
        includeSetups?: boolean;
        includePlans?: boolean;
        includeShortcuts?: boolean;
        includePoiCategories?: boolean;
        includeSkyRegions?: boolean;
      };
      ids?: string[];
      // Keyboard-shortcut bindings live in the client's localStorage; the client sends
      // them here so they can be bundled into the backup ZIP as shortcuts.json.
      shortcuts?: unknown;
    };

    // Support legacy mode='metadata' for backward compat with backup button
    const legacyMetadataOnly = body.mode === 'metadata';
    const options = body.options ?? {};
    const includeImages = legacyMetadataOnly ? false : options.includeImages !== false;
    const includeMetadata = options.includeMetadata !== false;
    const includeDsoOverrides = options.includeDsoOverrides === true;
    const includeCustomGear = options.includeCustomGear === true;
    const includeSetups = options.includeSetups === true;
    const includePlans = options.includePlans === true;
    const includeShortcuts = options.includeShortcuts === true;
    const includePoiCategories = options.includePoiCategories === true;
    const includeSkyRegions = options.includeSkyRegions === true;

    const { ids } = body;
    const allPhotos = await photosService.list();
    const selected =
      Array.isArray(ids) && ids.length > 0
        ? allPhotos.filter((p) => ids.includes(p.id))
        : allPhotos;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '-');

    if (legacyMetadataOnly) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.json"`);
      res.json(selected);
      return;
    }

    // Always produce a ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="sky-export-${dateStr}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => {
      console.error('[Export] archiver error:', err);
    });
    archive.pipe(res);

    if (includeMetadata) {
      const manifest = { manifestVersion: 1, photos: selected };
      archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' });
    }
    if (includeImages) {
      for (const photo of selected) {
        const filePath = path.join(UPLOADS_DIR, photo.filename);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: `images/${photo.filename}` });
        }
        if (photo.thumbFilename) {
          const thumbPath = path.join(UPLOADS_DIR, photo.thumbFilename);
          if (fs.existsSync(thumbPath)) {
            archive.file(thumbPath, { name: `images/${photo.thumbFilename}` });
          }
        }
      }
    }
    if (includeDsoOverrides) {
      const overrides = await dsoOverridesService.getAll();
      archive.append(Buffer.from(JSON.stringify(overrides, null, 2)), {
        name: 'dso-overrides.json',
      });
    }
    if (includeCustomGear) {
      const customGear = await gearService.exportCustom();
      archive.append(Buffer.from(JSON.stringify(customGear, null, 2)), {
        name: 'custom-gear.json',
      });
    }
    if (includeSetups) {
      const setups = await gearService.listSetups();
      archive.append(Buffer.from(JSON.stringify(setups, null, 2)), { name: 'gear-setups.json' });
    }
    if (includePoiCategories) {
      const cats = await poiCategoriesService.list();
      archive.append(Buffer.from(JSON.stringify(cats, null, 2)), { name: 'poi-categories.json' });
    }
    if (includeSkyRegions) {
      const regions = await skyRegionsService.list();
      archive.append(Buffer.from(JSON.stringify(regions, null, 2)), {
        name: 'sky-regions.json',
      });
    }
    if (includePlans) {
      // The plan list carries mosaicId/mosaicWDeg/mosaicHDeg so tiles re-group on import.
      const plans = await plansService.list();
      archive.append(Buffer.from(JSON.stringify(plans, null, 2)), { name: 'plans.json' });
    }
    if (includeShortcuts && body.shortcuts && typeof body.shortcuts === 'object') {
      archive.append(Buffer.from(JSON.stringify(body.shortcuts, null, 2)), {
        name: 'shortcuts.json',
      });
    }

    archive.finalize();
  } catch (err: any) {
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
      const zipDir = await unzipper.Open.buffer(file.buffer);
      const inspect = await inspectZipContents(zipDir.files as any);

      const filenameToOriginalName = new Map(
        inspect.photos.map((p) => [p.filename, p.originalName]),
      );
      const originalNames = inspect.photos.map((p) => p.originalName).filter(Boolean);
      const existingSet = new Set(
        originalNames.length > 0
          ? (await photosService.findByOriginalNames(originalNames)).map((r) => r.originalName)
          : [],
      );

      const images = inspect.imageEntries.map((entry) => ({
        filename: entry.filename,
        originalName: filenameToOriginalName.get(entry.filename) ?? entry.filename,
        size: entry.size,
        exists: existingSet.has(filenameToOriginalName.get(entry.filename) ?? ''),
      }));

      // Keyboard shortcuts are localStorage-only, so they aren't imported server-side:
      // we return the parsed bundle and the client applies it to localStorage.
      let hasShortcuts = false;
      let shortcuts: unknown;
      const shortcutsEntry = zipDir.files.find((f) => f.path === 'shortcuts.json');
      if (shortcutsEntry) {
        try {
          const parsed = JSON.parse((await shortcutsEntry.buffer()).toString('utf8'));
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            hasShortcuts = true;
            shortcuts = parsed;
          }
        } catch {
          /* ignore invalid shortcuts.json */
        }
      }

      // Resolve name-based conflicts: a plan/setup/gear whose name already exists
      // will be replaced (not duplicated) if the user selects it for import.
      const existingPlanNames = new Set((await plansService.listNames()).map((p) => p.name));
      const existingSetupNames = new Set((await gearService.listSetups()).map((s) => s.name));
      const existingGearKeys = new Set(
        (await gearService.listCustomNames()).map((g) => `${g.type}\u001f${g.name}`),
      );

      // Each setup of the bundle is compared with the local ones (same id, else same name);
      // each plan carries the setup id stored in the bundle.
      const readJson = async (entryPath: string): Promise<unknown> => {
        const entry = zipDir.files.find((f) => f.path === entryPath);
        if (!entry) return null;
        try {
          return JSON.parse((await entry.buffer()).toString('utf8'));
        } catch {
          return null;
        }
      };
      const bundleSetups = parseBundleSetups(await readJson('gear-setups.json'));
      const planSetupIds = new Map(
        parseBundlePlanSetupIds(await readJson('plans.json')).map((p) => [p.id, p.setupId]),
      );
      const localSetups = await gearService.listSetups();

      const plans = inspect.planItems.map((p) => ({
        ...p,
        exists: existingPlanNames.has(p.name),
        setupId: planSetupIds.get(p.id) ?? null,
      }));
      const setups = inspect.setupItems.map((s) => {
        const bundleSetup = bundleSetups.find((b) => b.id === s.id);
        const state = bundleSetup
          ? classifyBundleSetup(bundleSetup, localSetups)
          : { conflict: 'none' as const };
        return { ...s, exists: existingSetupNames.has(s.name), ...state };
      });
      const gear = inspect.gearItems.map((g) => ({
        ...g,
        exists: existingGearKeys.has(`${g.type}\u001f${g.name}`),
      }));

      res.json(
        buildZipPreviewResponse(inspect, { hasShortcuts, shortcuts, images, plans, setups, gear }),
      );
    } else if (ext === '.json') {
      const photos = JSON.parse(file.buffer.toString('utf8'));
      if (!Array.isArray(photos)) {
        res.status(400).json({ error: 'Format de manifeste invalide' });
        return;
      }
      res.json({
        hasMetadata: photos.length > 0,
        photos: photos.length,
        hasDsoOverrides: false,
        hasCustomGear: false,
        hasSetups: false,
        hasPoiCategories: false,
        hasSkyRegions: false,
        hasPlans: false,
        hasShortcuts: false,
        images: [],
        plans: [],
        setups: [],
        gear: [],
      });
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
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

    const importMetadata = req.body?.importMetadata === '1';
    const importDsoOverrides = req.body?.importDsoOverrides === '1';
    const importPoiCategories = req.body?.importPoiCategories === '1';
    const importSkyRegions = req.body?.importSkyRegions === '1';
    // null means "no image filter" (metadata-only import); a Set means "import only these filenames"
    const selectedImages: Set<string> | null = req.body?.selectedImages
      ? new Set(JSON.parse(req.body.selectedImages) as string[])
      : null;
    // Plans / setups / custom gear are now selected per item by id. An absent field
    // means "import none of that category"; a Set means "import only these ids".
    const parseIdSet = (raw: unknown): Set<string> =>
      typeof raw === 'string' ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
    const selectedPlans = parseIdSet(req.body?.selectedPlans);
    const selectedSetups = parseIdSet(req.body?.selectedSetups);
    const selectedGear = parseIdSet(req.body?.selectedGear);
    // Choice per bundle setup id for a setup whose content differs from a local one.
    const setupChoices: Record<string, string> =
      typeof req.body?.setupConflicts === 'string'
        ? (JSON.parse(req.body.setupConflicts) as Record<string, string>)
        : {};

    const ext = path.extname(file.originalname).toLowerCase();
    let photos: any[] = [];
    let dsoOverridesImported = 0;
    // Tracks which image basenames were successfully written to UPLOADS_DIR.
    // null means no image extraction happened (JSON import), so don't filter by it.
    let writtenFiles: Set<string> | null = null;

    if (ext === '.zip') {
      const zipDir = await unzipper.Open.buffer(file.buffer);

      // Security: validate all entry paths before extraction
      for (const entry of zipDir.files) {
        if (!isValidZipEntryPath(entry.path)) {
          res.status(400).json({ error: `Chemin invalide dans le ZIP : ${entry.path}` });
          return;
        }
      }

      const manifestEntry = zipDir.files.find((f) => f.path === 'manifest.json');
      const dsoOverridesEntry = zipDir.files.find((f) => f.path === 'dso-overrides.json');
      const customGearEntry = zipDir.files.find((f) => f.path === 'custom-gear.json');
      const gearSetupsEntry = zipDir.files.find((f) => f.path === 'gear-setups.json');
      const poiCategoriesEntry = zipDir.files.find((f) => f.path === 'poi-categories.json');
      const skyRegionsEntry = zipDir.files.find((f) => f.path === 'sky-regions.json');
      const plansEntry = zipDir.files.find((f) => f.path === 'plans.json');

      if (
        !manifestEntry &&
        !dsoOverridesEntry &&
        !customGearEntry &&
        !gearSetupsEntry &&
        !poiCategoriesEntry &&
        !skyRegionsEntry &&
        !plansEntry
      ) {
        res.status(400).json({ error: 'Aucun contenu reconnu dans le ZIP' });
        return;
      }

      if (manifestEntry) {
        const content = await manifestEntry.buffer();
        photos = parseManifestPhotos(JSON.parse(content.toString('utf8')));
      }

      // Import DSO overrides
      if (dsoOverridesEntry && importDsoOverrides) {
        try {
          const dsoOverrides = JSON.parse((await dsoOverridesEntry.buffer()).toString('utf8'));
          if (typeof dsoOverrides === 'object' && !Array.isArray(dsoOverrides)) {
            for (const [id, data] of Object.entries(dsoOverrides)) {
              if (
                typeof id === 'string' &&
                id.length <= 100 &&
                typeof data === 'object' &&
                data !== null &&
                !Array.isArray(data)
              ) {
                await dsoOverridesService.importOne(id, data as object);
                dsoOverridesImported++;
              }
            }
          }
        } catch {
          /* ignore invalid dso-overrides.json */
        }
      }

      // Decide what happens to the setups first: a ticked plan brings its setup, and the custom
      // gear that setup uses, when the bundle has them and this machine does not.
      const readBundleJson = async (entry: typeof plansEntry): Promise<unknown> => {
        if (!entry) return null;
        try {
          return JSON.parse((await entry.buffer()).toString('utf8'));
        } catch {
          return null;
        }
      };
      const rawGearList = await readBundleJson(customGearEntry);
      const rawSetupList = await readBundleJson(gearSetupsEntry);
      const rawPlanList = await readBundleJson(plansEntry);
      const setupPlan = planSetupImportActions({
        bundleSetups: parseBundleSetups(rawSetupList),
        bundlePlans: parseBundlePlanSetupIds(rawPlanList),
        bundleGearIds: Array.isArray(rawGearList)
          ? rawGearList.filter((g) => typeof g?.id === 'string').map((g) => g.id as string)
          : [],
        selectedPlans,
        selectedSetups,
        selectedGear,
        choices: setupChoices,
        localSetups: await gearService.listSetups(),
        localGearIds: new Set((await gearService.listCustomNames()).map((g) => g.id)),
        newId: uuidv4,
      });
      const gearToImport = new Set([...selectedGear, ...setupPlan.extraGearIds]);

      // Import custom gear (only the ids the user selected, plus the gear a written setup
      // needs). Name-based override: existing gear of the same type + name is deleted
      // before the imported one is written, so a re-imported item replaces rather than
      // duplicates.
      if (customGearEntry && gearToImport.size > 0) {
        try {
          const rawGear = rawGearList;
          if (Array.isArray(rawGear)) {
            // Snapshot existing gear once, before importing, so name-based replacement
            // targets only pre-import rows — two same-type+name items within this bundle
            // must not delete each other.
            const existingGear = await gearService.listCustomNames();
            for (const g of rawGear) {
              if (
                typeof g.id === 'string' &&
                gearToImport.has(g.id) &&
                ['telescope', 'camera', 'accessory'].includes(g.type)
              ) {
                const { id, type, ...data } = g;
                const name = typeof data.name === 'string' ? data.name : id;
                const sameType = existingGear.filter((r) => r.type === type);
                await gearService.importCustom(
                  { id, type: type as CustomGearType, data },
                  idsToReplaceByName(sameType, name),
                );
              }
            }
          }
        } catch {
          /* ignore invalid custom-gear.json */
        }
      }

      // Import gear setups: the ticked ones and the setups of ticked plans, as decided by
      // planSetupImportActions (replace by name only when the name is non-empty — an empty
      // name must not match, and delete, every existing unnamed setup).
      try {
        for (const a of setupPlan.actions) {
          if (a.setup) await gearService.importSetup(a.setup, a.replaceIds);
        }
      } catch (setupErr) {
        console.error('[Import] Failed to import gear setups', setupErr);
      }

      // Import POI categories (id-based upsert: a re-imported category with the same
      // id replaces the existing one, keeping any photos' POI references valid).
      if (poiCategoriesEntry && importPoiCategories) {
        try {
          const rawCats = JSON.parse((await poiCategoriesEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawCats)) {
            for (const [ci, c] of rawCats.entries()) {
              if (typeof c?.id !== 'string' || typeof c?.name !== 'string') continue;
              await poiCategoriesService.importOne({
                id: c.id,
                name: c.name,
                color: typeof c.color === 'string' && c.color.trim() ? c.color : '#888888',
                position: Number.isFinite(c.position) ? Number(c.position) : ci,
              });
            }
          }
        } catch {
          /* ignore invalid poi-categories.json */
        }
      }

      // Import sky regions (id-based upsert: a re-imported region with the same id
      // replaces the existing one).
      if (skyRegionsEntry && importSkyRegions) {
        try {
          const rawRegions = JSON.parse((await skyRegionsEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawRegions)) {
            for (const [ri, r] of rawRegions.entries()) {
              if (
                typeof r?.id !== 'string' ||
                typeof r?.name !== 'string' ||
                !Array.isArray(r.points)
              ) {
                continue;
              }
              await skyRegionsService.importOne({
                id: r.id,
                name: r.name,
                color: typeof r.color === 'string' && r.color.trim() ? r.color : '#4ea1ff',
                points: r.points,
                position: Number.isFinite(r.position) ? Number(r.position) : ri,
              });
            }
          }
        } catch {
          /* ignore invalid sky-regions.json */
        }
      }

      // Import night plans (only the ids the user selected). Name-based override:
      // an existing plan with the same name is deleted (with its entries) before the
      // imported one is recreated, so a re-imported plan replaces rather than
      // duplicates. The bundle's id is kept so its entry/mosaic/setup refs resolve;
      // we also delete any same-id row to avoid a primary-key collision on recreate.
      if (plansEntry && selectedPlans.size > 0) {
        try {
          const rawPlans = rawPlanList;
          if (Array.isArray(rawPlans)) {
            // Snapshot once so two same-name plans in this bundle don't delete each
            // other; replace by name only when non-empty. Same-id collisions are
            // handled by importPlan, which also deletes any plan with the same id.
            const existingPlans = await plansService.listNames();
            for (const [pi, p] of rawPlans.entries()) {
              if (typeof p.id !== 'string' || typeof p.name !== 'string') continue;
              if (!selectedPlans.has(p.id)) continue;
              await plansService.importPlan(p, {
                replaceIds: p.name ? idsToReplaceByName(existingPlans, p.name) : [],
                // A setup this import skipped or kept under another id is pointed at its local twin.
                setupId:
                  typeof p.setupId === 'string'
                    ? (setupPlan.setupIdRemap[p.setupId] ?? p.setupId)
                    : null,
                index: pi,
              });
            }
          }
        } catch {
          /* ignore invalid plans.json */
        }
      }

      // Flush libvips handle cache before writing to avoid Windows sharing violations
      // when re-importing the same files that sharp processed in a previous request.
      sharp.cache(false);

      // Extract selected image files to UPLOADS_DIR (always overwrite)
      const imageEntries = zipDir.files.filter(
        (f) => f.path.startsWith('images/') && f.type === 'File',
      );
      writtenFiles = new Set<string>();
      // Without a selection, files are written only for the photo records this same
      // request imports (all photos of the manifest); otherwise they would belong to no photo.
      const importsPhotoRecords = importMetadata && photos.length > 0;
      for (const entry of imageEntries) {
        if (selectedImages === null && !importsPhotoRecords) continue;
        const baseName = path.basename(entry.path);
        const ext2 = path.extname(baseName).toLowerCase();
        if (!ALLOWED_PHOTO_EXTENSIONS.has(ext2)) continue;
        if (selectedImages !== null && !selectedImages.has(baseName)) continue;
        const destPath = path.join(UPLOADS_DIR, baseName);
        try {
          const buf = await entry.buffer();
          await fs.promises.writeFile(destPath, buf);
          writtenFiles.add(baseName);
        } catch (writeErr) {
          console.warn(`[Import] Failed to write ${baseName}:`, writeErr);
        }
      }
    } else if (ext === '.json') {
      photos = JSON.parse(file.buffer.toString('utf8'));
    } else {
      res.status(400).json({ error: 'Format non supporté (.zip ou .json attendu)' });
      return;
    }

    if (!Array.isArray(photos)) {
      res.status(400).json({ error: 'Format de manifeste invalide' });
      return;
    }

    let imported = 0;
    let skipped = 0;

    if (importMetadata && photos.length > 0) {
      const allNames = photos.map((p: any) => p.originalName ?? p.filename ?? p.id).filter(Boolean);
      const existingByName = new Map(
        (await photosService.findByOriginalNames(allNames)).map((r) => [r.originalName, r.id]),
      );

      for (const p of photos) {
        if (!p.id || typeof p.id !== 'string') {
          skipped++;
          continue;
        }
        const origName: string = p.originalName ?? p.filename ?? p.id;

        // Skip photos whose image file was not written (not selected, or write failed)
        if (writtenFiles !== null && !writtenFiles.has(p.filename)) {
          skipped++;
          continue;
        }

        const existingId = existingByName.get(origName);
        if (existingId) await photosService.removeRow(existingId);

        const result = await photosService.importPhoto(p, 'skip');
        if (result === 'imported') imported++;
        else skipped++;
      }
    }

    // Regenerate any missing thumbnails
    const photosToThumb = importMetadata
      ? photos.filter((p: any) => writtenFiles === null || writtenFiles.has(p.filename))
      : [];
    for (const p of photosToThumb) {
      if (!p.id || typeof p.id !== 'string') continue;
      const filename: string = p.filename ?? `${p.id}.jpg`;
      const thumbFilename: string = p.thumbFilename ?? thumbnailNameOf(filename);
      try {
        await photosService.ensureThumbnail(filename, thumbFilename);
      } catch (thumbErr) {
        console.warn(`[Import] Thumbnail regeneration failed for ${filename}:`, thumbErr);
      }
    }

    res.json({ imported, skipped, dsoOverridesImported });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});
