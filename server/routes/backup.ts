import express from 'express';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../server-paths.js';
import { ALLOWED_PHOTO_EXTENSIONS, uploadBundle, sanitizeIntegrationRows } from './shared.js';
import { poiCategoryToApi, planEntryToApi, planMosaicToApi, PLAN_SORT_KEYS } from './mappers.js';
import {
  getAllPhotos,
  deletePhoto,
  createPhotoWithId,
  checkPhotosExistByName,
  getAllCustomGear,
  upsertCustomGear as upsertCustomGearDB,
  deleteCustomGear as deleteCustomGearDB,
  getAllGearSetups,
  upsertGearSetup,
  deleteGearSetup,
  sanitizePois,
  sanitizeCaptureDetails,
  getAllPoiCategories,
  upsertPoiCategory,
  getPlans,
  getAllPlanEntries,
  createPlan,
  deletePlan,
  addPlanEntry,
  sanitizeObservationWindows,
  getAllPlanMosaics,
  addPlanMosaic,
  type PlanEntryRow,
  type PlanMosaicRow,
} from '../db.js';
import {
  dsoOverrides as dsoOverridesService,
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
    const allPhotos = getAllPhotos();
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
      const customGear = getAllCustomGear().map((g) => ({
        id: g.id,
        type: g.type,
        ...JSON.parse(g.data),
      }));
      archive.append(Buffer.from(JSON.stringify(customGear, null, 2)), {
        name: 'custom-gear.json',
      });
    }
    if (includeSetups) {
      const setups = getAllGearSetups().map((r) => ({
        id: r.id,
        name: r.name,
        telescopeId: r.telescope_id,
        cameraId: r.camera_id,
        accessoryId: r.accessory_id,
        enabled: r.enabled === 1,
      }));
      archive.append(Buffer.from(JSON.stringify(setups, null, 2)), { name: 'gear-setups.json' });
    }
    if (includePoiCategories) {
      const cats = getAllPoiCategories().map(poiCategoryToApi);
      archive.append(Buffer.from(JSON.stringify(cats, null, 2)), { name: 'poi-categories.json' });
    }
    if (includeSkyRegions) {
      const regions = await skyRegionsService.list();
      archive.append(Buffer.from(JSON.stringify(regions, null, 2)), {
        name: 'sky-regions.json',
      });
    }
    if (includePlans) {
      const entriesByPlan = new Map<string, PlanEntryRow[]>();
      for (const e of getAllPlanEntries()) {
        const list = entriesByPlan.get(e.plan_id) ?? [];
        list.push(e);
        entriesByPlan.set(e.plan_id, list);
      }
      const mosaicsByPlan = new Map<string, PlanMosaicRow[]>();
      for (const m of getAllPlanMosaics()) {
        const list = mosaicsByPlan.get(m.plan_id) ?? [];
        list.push(m);
        mosaicsByPlan.set(m.plan_id, list);
      }
      const plans = getPlans().map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nightOf: p.night_of ?? null,
        setupId: p.setup_id ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        sortBy: p.sort_by ?? 'transit',
        // planEntryToApi carries mosaicId/mosaicWDeg/mosaicHDeg so tiles re-group on import.
        entries: (entriesByPlan.get(p.id) ?? []).map(planEntryToApi),
        mosaics: (mosaicsByPlan.get(p.id) ?? []).map(planMosaicToApi),
      }));
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
 *     responses:
 *       200:
 *         description: Import preview returned successfully
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
          ? checkPhotosExistByName(originalNames).map((r) => r.originalName)
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
      const existingPlanNames = new Set(getPlans().map((p) => p.name));
      const existingSetupNames = new Set(getAllGearSetups().map((s) => s.name));
      const existingGearKeys = new Set(
        getAllCustomGear().map((g) => {
          let name = g.id;
          try {
            const d = JSON.parse(g.data);
            if (typeof d?.name === 'string') name = d.name;
          } catch {
            /* ignore */
          }
          return `${g.type}\u001f${name}`;
        }),
      );

      const plans = inspect.planItems.map((p) => ({ ...p, exists: existingPlanNames.has(p.name) }));
      const setups = inspect.setupItems.map((s) => ({
        ...s,
        exists: existingSetupNames.has(s.name),
      }));
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
 *     consumes:
 *       - multipart/form-data
 *     responses:
 *       200:
 *         description: Import completed successfully
 */
// Import photos from ZIP (full) or JSON (metadata only)
// Form fields: bundle (file), importMetadata, importDsoOverrides, selectedImages,
//              selectedPlans, selectedSetups, selectedGear (all JSON string[])
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

      // Import custom gear (only the ids the user selected). Name-based override:
      // existing gear of the same type + name is deleted before the imported one is
      // written, so a re-imported item replaces rather than duplicates.
      if (customGearEntry && selectedGear.size > 0) {
        try {
          const rawGear = JSON.parse((await customGearEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawGear)) {
            // Snapshot existing gear once, before importing, so name-based replacement
            // targets only pre-import rows — two same-type+name items within this bundle
            // must not delete each other.
            const existingGear = getAllCustomGear().map((r) => {
              let n = r.id;
              try {
                const d = JSON.parse(r.data);
                if (typeof d?.name === 'string') n = d.name;
              } catch {
                /* ignore */
              }
              return { id: r.id, type: r.type, name: n };
            });
            for (const g of rawGear) {
              if (
                typeof g.id === 'string' &&
                selectedGear.has(g.id) &&
                ['telescope', 'camera', 'accessory'].includes(g.type)
              ) {
                const { id, type, ...data } = g;
                const name = typeof data.name === 'string' ? data.name : id;
                const sameType = existingGear.filter((r) => r.type === type);
                idsToReplaceByName(sameType, name).forEach(deleteCustomGearDB);
                upsertCustomGearDB(id, type as 'telescope' | 'camera' | 'accessory' | 'filter', {
                  ...data,
                  id,
                });
              }
            }
          }
        } catch {
          /* ignore invalid custom-gear.json */
        }
      }

      // Import gear setups (only the ids the user selected). Name-based override:
      // an existing setup with the same name is deleted before the imported one is
      // written, so a re-imported setup replaces rather than duplicates.
      if (gearSetupsEntry && selectedSetups.size > 0) {
        try {
          const rawSetups = JSON.parse((await gearSetupsEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawSetups)) {
            // Snapshot once (so same-name siblings in this bundle don't delete each
            // other) and only replace by name when the name is non-empty — an empty
            // name must not match, and delete, every existing unnamed setup. Same-id
            // re-imports are still handled by upsertGearSetup.
            const existingSetups = getAllGearSetups();
            for (const s of rawSetups) {
              if (
                typeof s.id === 'string' &&
                selectedSetups.has(s.id) &&
                typeof s.telescopeId === 'string' &&
                typeof s.cameraId === 'string'
              ) {
                const name = typeof s.name === 'string' ? s.name : '';
                if (name) idsToReplaceByName(existingSetups, name).forEach(deleteGearSetup);
                upsertGearSetup({
                  id: s.id,
                  name: typeof s.name === 'string' ? s.name : '',
                  telescope_id: s.telescopeId,
                  camera_id: s.cameraId,
                  accessory_id: typeof s.accessoryId === 'string' ? s.accessoryId : null,
                  enabled: s.enabled === false ? 0 : 1,
                });
              }
            }
          }
        } catch {
          /* ignore invalid gear-setups.json */
        }
      }

      // Import POI categories (id-based upsert: a re-imported category with the same
      // id replaces the existing one, keeping any photos' POI references valid).
      if (poiCategoriesEntry && importPoiCategories) {
        try {
          const rawCats = JSON.parse((await poiCategoriesEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawCats)) {
            rawCats.forEach((c, ci) => {
              if (typeof c?.id !== 'string' || typeof c?.name !== 'string') return;
              upsertPoiCategory({
                id: c.id,
                name: c.name,
                color: typeof c.color === 'string' && c.color.trim() ? c.color : '#888888',
                position: Number.isFinite(c.position) ? Number(c.position) : ci,
              });
            });
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
          const rawPlans = JSON.parse((await plansEntry.buffer()).toString('utf8'));
          if (Array.isArray(rawPlans)) {
            // Snapshot once so two same-name plans in this bundle don't delete each
            // other; replace by name only when non-empty. Same-id collisions are
            // handled by the explicit deletePlan(p.id) below.
            const existingPlans = getPlans();
            rawPlans.forEach((p, pi) => {
              if (typeof p.id !== 'string' || typeof p.name !== 'string') return;
              if (!selectedPlans.has(p.id)) return;
              if (p.name) idsToReplaceByName(existingPlans, p.name).forEach(deletePlan);
              deletePlan(p.id);
              createPlan({
                id: p.id,
                name: p.name,
                position: typeof p.position === 'number' ? p.position : pi,
                created_at: new Date().toISOString(),
                night_of: typeof p.nightOf === 'string' ? p.nightOf : null,
                setup_id: typeof p.setupId === 'string' ? p.setupId : null,
                lat: typeof p.lat === 'number' ? p.lat : null,
                lon: typeof p.lon === 'number' ? p.lon : null,
                sort_by: PLAN_SORT_KEYS.includes(p.sortBy) ? p.sortBy : 'transit',
              });
              if (Array.isArray(p.entries)) {
                p.entries.forEach((e: any, ei: number) => {
                  if (typeof e.id !== 'string') return;
                  const hasDso = typeof e.dsoId === 'string';
                  const hasCoords = typeof e.ra === 'number' && typeof e.dec === 'number';
                  // An entry needs either a DSO target or explicit frame coords.
                  if (!hasDso && !hasCoords) return;
                  addPlanEntry({
                    id: e.id,
                    plan_id: p.id,
                    dso_id: hasDso ? e.dsoId : null,
                    position: typeof e.position === 'number' ? e.position : ei,
                    pa_deg: typeof e.paDeg === 'number' ? e.paDeg : null,
                    ra: hasCoords ? e.ra : null,
                    dec: hasCoords ? e.dec : null,
                    notes: typeof e.notes === 'string' ? e.notes : null,
                    // Keep the tile→mosaic grouping (the mosaic row is recreated below).
                    mosaic_id: typeof e.mosaicId === 'string' ? e.mosaicId : null,
                    mosaic_w_deg: typeof e.mosaicWDeg === 'number' ? e.mosaicWDeg : null,
                    mosaic_h_deg: typeof e.mosaicHDeg === 'number' ? e.mosaicHDeg : null,
                    observation_windows: sanitizeObservationWindows(e.observationWindows),
                  });
                });
              }
              if (Array.isArray(p.mosaics)) {
                p.mosaics.forEach((m: any, mi: number) => {
                  if (typeof m.id !== 'string') return;
                  if (typeof m.centerRa !== 'number' || typeof m.centerDec !== 'number') return;
                  addPlanMosaic({
                    id: m.id,
                    plan_id: p.id,
                    dso_id: typeof m.dsoId === 'string' ? m.dsoId : null,
                    name: typeof m.name === 'string' ? m.name : null,
                    center_ra: m.centerRa,
                    center_dec: m.centerDec,
                    pa_deg: typeof m.paDeg === 'number' ? m.paDeg : 0,
                    overlap_pct: typeof m.overlapPct === 'number' ? m.overlapPct : 20,
                    cols: Number.isInteger(m.cols) ? m.cols : 1,
                    rows: Number.isInteger(m.rows) ? m.rows : 1,
                    position: typeof m.position === 'number' ? m.position : mi,
                  });
                });
              }
            });
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
      for (const entry of imageEntries) {
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
        checkPhotosExistByName(allNames).map((r) => [r.originalName, r.id]),
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
        if (existingId) deletePhoto(existingId);

        const corrs = Array.isArray(p.correspondences) ? p.correspondences : [];
        const thumbFilename =
          typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null;
        const result = createPhotoWithId(
          p.id,
          p.filename ?? `${p.id}.jpg`,
          origName,
          p.width ?? 0,
          p.height ?? 0,
          corrs,
          p.createdAt ?? null,
          p.manualPlacement ? JSON.stringify(p.manualPlacement) : null,
          Array.isArray(p.dsoIds) ? p.dsoIds : [],
          Array.isArray(p.labels) ? p.labels : [],
          typeof p.notes === 'string' ? p.notes : '',
          'skip',
          sanitizeIntegrationRows(p.integrations),
          thumbFilename,
          typeof p.observationDate === 'string' ? p.observationDate : null,
          sanitizePois(p.pointsOfInterest),
          sanitizeCaptureDetails(p.captureDetails),
          typeof p.gearSetupId === 'string' ? p.gearSetupId : null,
        );
        if (result === 'imported') imported++;
        else skipped++;
      }
    }

    // Regenerate any missing thumbnails
    const THUMB_SIZE = 400;
    const photosToThumb = importMetadata
      ? photos.filter((p: any) => writtenFiles === null || writtenFiles.has(p.filename))
      : [];
    for (const p of photosToThumb) {
      if (!p.id || typeof p.id !== 'string') continue;
      const filename: string = p.filename ?? `${p.id}.jpg`;
      const thumbFilename: string = p.thumbFilename ?? filename.replace(/(\.[^.]+)$/, '_thumb.jpg');
      const fullPath = path.join(UPLOADS_DIR, filename);
      const thumbPath = path.join(UPLOADS_DIR, thumbFilename);
      if (fs.existsSync(fullPath) && !fs.existsSync(thumbPath)) {
        try {
          const meta = await sharp(fullPath).metadata();
          const w = meta.width ?? 0;
          const h = meta.height ?? 0;
          const scale = Math.min(1, THUMB_SIZE / Math.max(w, h, 1));
          await sharp(fullPath)
            .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
            .jpeg({ quality: 75 })
            .toFile(thumbPath);
        } catch (thumbErr) {
          console.warn(`[Import] Thumbnail regeneration failed for ${filename}:`, thumbErr);
        }
      }
    }

    res.json({ imported, skipped, dsoOverridesImported });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});
