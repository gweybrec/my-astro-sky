/**
 * Backup: the export of the user's data to an archive, the preview of an archive, and its import.
 * The archive itself is a port (`BundleWriter`, `BundleReader`); every write goes through the service
 * that owns the data, one grouped write per item (a plan, a setup, a photo with its correspondences).
 * The archive format (entry names, order, manifest) is the one the desktop app has always written.
 */
import {
  buildZipPreviewResponse,
  baseNameOf,
  classifyBundleSetup,
  decodeUtf8,
  extNameOf,
  idsToReplaceByName,
  inspectZipContents,
  isValidZipEntryPath,
  parseBundlePlanSetupIds,
  parseBundleSetups,
  parseManifestPhotos,
  planSetupImportActions,
  type ExportRequest,
  type ImportFailure,
  type ImportOptions,
  type ImportPreviewResult,
  type ImportResult,
  type ZipEntry,
} from '../domain/backup';
import { DomainError } from '../domain/errors';
import type { CustomGearType } from '../domain/gear';
import type { BlobStore } from '../ports/blob-store';
import type { BundleReader, BundleWriter } from '../ports/bundle';
import type { Photo } from '../types';
import type { DsoOverrideService } from './dso-overrides';
import type { GearService } from './gear';
import type { PhotoService } from './photos';
import { ALLOWED_PHOTO_EXTENSIONS, thumbnailNameOf } from './photos';
import type { PlanService } from './plans';
import type { PoiCategoryService } from './poi-categories';
import type { SkyRegionService } from './sky-regions';

export interface BackupServiceDeps {
  photos: PhotoService;
  plans: PlanService;
  gear: GearService;
  dsoOverrides: DsoOverrideService;
  poiCategories: PoiCategoryService;
  skyRegions: SkyRegionService;
  blobs: BlobStore;
  /** A fresh unique id. */
  newId: () => string;
}

export interface BackupService {
  /** The photos an export takes: those whose id is in `ids`, or all of them when `ids` is absent or empty. */
  selectPhotos(ids?: readonly string[]): Promise<Photo[]>;
  /**
   * Writes the archive: `manifest.json`, the images (and thumbnails that exist), then, for each ticked
   * option, `dso-overrides.json`, `custom-gear.json`, `gear-setups.json`, `poi-categories.json`,
   * `sky-regions.json`, `plans.json` and `shortcuts.json`, in that order. Images are read and added one by one.
   */
  exportTo(writer: BundleWriter, request: ExportRequest): Promise<void>;
  /** What an archive holds and which of it already exists here; writes nothing. */
  preview(reader: BundleReader): Promise<ImportPreviewResult>;
  /** The preview of a plain JSON list of photos. Throws `invalid` (`INVALID_MANIFEST_FORMAT`) when it is not a list. */
  previewPhotoList(photos: unknown): ImportPreviewResult;
  /**
   * Imports what `selection` asks for from an archive. Throws `invalid` for an entry path that could leave its
   * folder (`INVALID_ENTRY_PATH`) and for an archive with no recognised file (`NO_RECOGNISED_CONTENT`). An item that
   * cannot be written is listed in `failed` and the others are imported.
   */
  importFrom(reader: BundleReader, selection: ImportOptions): Promise<ImportResult>;
  /** Imports a plain JSON list of photos (metadata only). Throws `invalid` (`INVALID_MANIFEST_FORMAT`) when it is not a list. */
  importPhotoList(photos: unknown, selection: ImportOptions): Promise<ImportResult>;
}

const invalidManifest = (): DomainError =>
  new DomainError('invalid', 'Format de manifeste invalide', { code: 'INVALID_MANIFEST_FORMAT' });

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));

/** A photo record of a manifest: whatever the file holds. */
type ManifestPhoto = Record<string, any>;

export function createBackupService(deps: BackupServiceDeps): BackupService {
  const { photos, plans, gear, dsoOverrides, poiCategories, skyRegions, blobs, newId } = deps;

  async function selectPhotos(ids?: readonly string[]): Promise<Photo[]> {
    const all = await photos.list();
    return Array.isArray(ids) && ids.length > 0 ? all.filter((p) => ids.includes(p.id)) : all;
  }

  /** The text of one JSON file of an archive, parsed; null when the file is missing or is not JSON. */
  async function readJson(reader: BundleReader, names: readonly string[], name: string) {
    if (!names.includes(name)) return null;
    try {
      return JSON.parse(decodeUtf8((await reader.read(name)) ?? new Uint8Array()));
    } catch {
      return null;
    }
  }

  /** The entries of an archive in the shape `inspectZipContents` reads. Only image sizes are looked up. */
  async function entriesOf(reader: BundleReader, names: readonly string[]): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];
    for (const name of names) {
      const isDir = name.endsWith('/');
      entries.push({
        path: name,
        type: isDir ? 'Directory' : 'File',
        uncompressedSize:
          !isDir && name.startsWith('images/') ? ((await reader.size(name)) ?? 0) : 0,
        buffer: async () => (await reader.read(name)) ?? new Uint8Array(),
      });
    }
    return entries;
  }

  /** Writes the photo records the selection asks for, then the missing thumbnails. */
  async function importPhotoRecords(
    list: ManifestPhoto[],
    importMetadata: boolean,
    writtenFiles: Set<string> | null,
    recordFailure: (kind: ImportFailure['kind'], name: string, err: unknown) => void,
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    if (importMetadata && list.length > 0) {
      const allNames = list.map((p) => p.originalName ?? p.filename ?? p.id).filter(Boolean);
      const existingByName = new Map(
        (await photos.findByOriginalNames(allNames)).map((r) => [r.originalName, r.id]),
      );

      for (const p of list) {
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

        try {
          const existingId = existingByName.get(origName);
          if (existingId) await photos.removeRow(existingId);

          const result = await photos.importPhoto(p as any, 'skip');
          if (result === 'imported') imported++;
          else skipped++;
        } catch (photoErr) {
          recordFailure('photo', origName, photoErr);
        }
      }
    }

    // Regenerate any missing thumbnails
    const photosToThumb = importMetadata
      ? list.filter((p) => writtenFiles === null || writtenFiles.has(p.filename))
      : [];
    for (const p of photosToThumb) {
      if (!p.id || typeof p.id !== 'string') continue;
      const filename: string = p.filename ?? `${p.id}.jpg`;
      const thumbFilename: string = p.thumbFilename ?? thumbnailNameOf(filename);
      try {
        await photos.ensureThumbnail(filename, thumbFilename);
      } catch (thumbErr) {
        console.warn(`[Import] Thumbnail regeneration failed for ${filename}:`, thumbErr);
      }
    }
    return { imported, skipped };
  }

  const makeFailureRecorder = (failed: ImportFailure[]) => {
    return (kind: ImportFailure['kind'], name: string, err: unknown): void => {
      failed.push({ kind, name });
      console.error(`[Import] Failed to import ${kind} "${name}"`, err);
    };
  };

  const service: BackupService = {
    selectPhotos,

    async exportTo(writer, request) {
      const options = request.options ?? {};
      const includeImages = options.includeImages !== false;
      const includeMetadata = options.includeMetadata !== false;
      const selected = await selectPhotos(request.ids);

      if (includeMetadata) {
        await writer.add('manifest.json', encode({ manifestVersion: 1, photos: selected }));
      }
      if (includeImages) {
        for (const photo of selected) {
          const image = await blobs.get(photo.filename);
          if (image) await writer.add(`images/${photo.filename}`, image);
          if (photo.thumbFilename) {
            const thumb = await blobs.get(photo.thumbFilename);
            if (thumb) await writer.add(`images/${photo.thumbFilename}`, thumb);
          }
        }
      }
      if (options.includeDsoOverrides === true) {
        await writer.add('dso-overrides.json', encode(await dsoOverrides.getAll()));
      }
      if (options.includeCustomGear === true) {
        await writer.add('custom-gear.json', encode(await gear.exportCustom()));
      }
      if (options.includeSetups === true) {
        await writer.add('gear-setups.json', encode(await gear.listSetups()));
      }
      if (options.includePoiCategories === true) {
        await writer.add('poi-categories.json', encode(await poiCategories.list()));
      }
      if (options.includeSkyRegions === true) {
        await writer.add('sky-regions.json', encode(await skyRegions.list()));
      }
      if (options.includePlans === true) {
        // The plan list carries mosaicId/mosaicWDeg/mosaicHDeg so tiles re-group on import.
        await writer.add('plans.json', encode(await plans.list()));
      }
      if (
        options.includeShortcuts === true &&
        request.shortcuts &&
        typeof request.shortcuts === 'object'
      ) {
        await writer.add('shortcuts.json', encode(request.shortcuts));
      }
    },

    async preview(reader) {
      const names = await reader.names();
      const inspect = await inspectZipContents(await entriesOf(reader, names));

      const filenameToOriginalName = new Map(
        inspect.photos.map((p) => [p.filename, p.originalName]),
      );
      const originalNames = inspect.photos.map((p) => p.originalName).filter(Boolean);
      const existingSet = new Set(
        originalNames.length > 0
          ? (await photos.findByOriginalNames(originalNames)).map((r) => r.originalName)
          : [],
      );

      const images = inspect.imageEntries.map((entry) => ({
        filename: entry.filename,
        originalName: filenameToOriginalName.get(entry.filename) ?? entry.filename,
        size: entry.size,
        exists: existingSet.has(filenameToOriginalName.get(entry.filename) ?? ''),
      }));

      // Keyboard shortcuts are localStorage-only, so they aren't imported here:
      // the preview returns the parsed bundle and the client applies it to localStorage.
      let hasShortcuts = false;
      let shortcuts: unknown;
      if (names.includes('shortcuts.json')) {
        try {
          const parsed = JSON.parse(
            decodeUtf8((await reader.read('shortcuts.json')) ?? new Uint8Array()),
          );
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
      const existingPlanNames = new Set((await plans.listNames()).map((p) => p.name));
      const localSetups = await gear.listSetups();
      const existingSetupNames = new Set(localSetups.map((s) => s.name));
      const existingGearKeys = new Set(
        (await gear.listCustomNames()).map((g) => `${g.type}\u001f${g.name}`),
      );

      // Each setup of the bundle is compared with the local ones (same id, else same name);
      // each plan carries the setup id stored in the bundle.
      const bundleSetups = parseBundleSetups(await readJson(reader, names, 'gear-setups.json'));
      const planSetupIds = new Map(
        parseBundlePlanSetupIds(await readJson(reader, names, 'plans.json')).map((p) => [
          p.id,
          p.setupId,
        ]),
      );

      const planEntries = inspect.planItems.map((p) => ({
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
      const gearEntries = inspect.gearItems.map((g) => ({
        ...g,
        exists: existingGearKeys.has(`${g.type}\u001f${g.name}`),
      }));

      return buildZipPreviewResponse(inspect, {
        hasShortcuts,
        shortcuts,
        images,
        plans: planEntries,
        setups,
        gear: gearEntries,
      });
    },

    previewPhotoList(list) {
      if (!Array.isArray(list)) throw invalidManifest();
      return {
        hasMetadata: list.length > 0,
        photos: list.length,
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
      };
    },

    async importFrom(reader, selection) {
      const importMetadata = selection.importMetadata === true;
      const importDsoOverrides = selection.importDsoOverrides === true;
      const importPoiCategories = selection.importPoiCategories === true;
      const importSkyRegions = selection.importSkyRegions === true;
      // null means "no image filter" (metadata-only import); a Set means "import only these filenames"
      const selectedImages: Set<string> | null = selection.selectedImages
        ? new Set(selection.selectedImages)
        : null;
      const selectedPlans = new Set(selection.selectedPlans ?? []);
      const selectedSetups = new Set(selection.selectedSetups ?? []);
      const selectedGear = new Set(selection.selectedGear ?? []);
      const setupChoices: Record<string, string> = selection.setupConflicts ?? {};

      let dsoOverridesImported = 0;
      // Items that could not be restored; the others are still imported.
      const failed: ImportFailure[] = [];
      const recordFailure = makeFailureRecorder(failed);

      const names = await reader.names();

      // Security: validate all entry paths before extraction
      for (const name of names) {
        if (!isValidZipEntryPath(name)) {
          throw new DomainError('invalid', `Chemin invalide dans le ZIP : ${name}`, {
            code: 'INVALID_ENTRY_PATH',
          });
        }
      }

      const has = (name: string): boolean => names.includes(name);
      if (
        !has('manifest.json') &&
        !has('dso-overrides.json') &&
        !has('custom-gear.json') &&
        !has('gear-setups.json') &&
        !has('poi-categories.json') &&
        !has('sky-regions.json') &&
        !has('plans.json')
      ) {
        throw new DomainError('invalid', 'Aucun contenu reconnu dans le ZIP', {
          code: 'NO_RECOGNISED_CONTENT',
        });
      }

      let list: ManifestPhoto[] = [];
      if (has('manifest.json')) {
        const content = (await reader.read('manifest.json')) ?? new Uint8Array();
        list = parseManifestPhotos(JSON.parse(decodeUtf8(content))) as ManifestPhoto[];
      }

      // Import DSO overrides
      if (has('dso-overrides.json') && importDsoOverrides) {
        try {
          const overrides = JSON.parse(
            decodeUtf8((await reader.read('dso-overrides.json')) ?? new Uint8Array()),
          );
          if (typeof overrides === 'object' && !Array.isArray(overrides)) {
            for (const [id, data] of Object.entries(overrides)) {
              if (
                typeof id === 'string' &&
                id.length <= 100 &&
                typeof data === 'object' &&
                data !== null &&
                !Array.isArray(data)
              ) {
                await dsoOverrides.importOne(id, data as object);
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
      const rawGearList = await readJson(reader, names, 'custom-gear.json');
      const rawSetupList = await readJson(reader, names, 'gear-setups.json');
      const rawPlanList = await readJson(reader, names, 'plans.json');
      const localSetups = await gear.listSetups();
      // One snapshot of the existing gear, taken before anything is imported: it gives the ids this
      // machine has, and name-based replacement targets only pre-import rows, so two same-type+name
      // items within this bundle must not delete each other.
      const existingGear = await gear.listCustomNames();
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
        localSetups,
        localGearIds: new Set(existingGear.map((g) => g.id)),
        newId,
      });
      const gearToImport = new Set([...selectedGear, ...setupPlan.extraGearIds]);

      // Import custom gear (only the ids the user selected, plus the gear a written setup
      // needs). Name-based override: existing gear of the same type + name is deleted
      // before the imported one is written, so a re-imported item replaces rather than
      // duplicates.
      if (has('custom-gear.json') && gearToImport.size > 0) {
        try {
          if (Array.isArray(rawGearList)) {
            for (const g of rawGearList) {
              if (
                typeof g.id === 'string' &&
                gearToImport.has(g.id) &&
                ['telescope', 'camera', 'accessory'].includes(g.type)
              ) {
                const { id, type, ...data } = g;
                const name = typeof data.name === 'string' ? data.name : id;
                const sameType = existingGear.filter((r) => r.type === type);
                try {
                  await gear.importCustom(
                    { id, type: type as CustomGearType, data },
                    idsToReplaceByName(sameType, name),
                  );
                } catch (itemErr) {
                  recordFailure('gear', name, itemErr);
                }
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
      for (const a of setupPlan.actions) {
        if (!a.setup) continue;
        try {
          await gear.importSetup(a.setup, a.replaceIds);
        } catch (setupErr) {
          recordFailure('setup', a.setup.name || a.setup.id, setupErr);
        }
      }

      // Import POI categories (id-based upsert: a re-imported category with the same
      // id replaces the existing one, keeping any photos' POI references valid).
      if (has('poi-categories.json') && importPoiCategories) {
        try {
          const rawCats = JSON.parse(
            decodeUtf8((await reader.read('poi-categories.json')) ?? new Uint8Array()),
          );
          if (Array.isArray(rawCats)) {
            for (const [ci, c] of rawCats.entries()) {
              if (typeof c?.id !== 'string' || typeof c?.name !== 'string') continue;
              await poiCategories.importOne({
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
      if (has('sky-regions.json') && importSkyRegions) {
        try {
          const rawRegions = JSON.parse(
            decodeUtf8((await reader.read('sky-regions.json')) ?? new Uint8Array()),
          );
          if (Array.isArray(rawRegions)) {
            for (const [ri, r] of rawRegions.entries()) {
              if (
                typeof r?.id !== 'string' ||
                typeof r?.name !== 'string' ||
                !Array.isArray(r.points)
              ) {
                continue;
              }
              await skyRegions.importOne({
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
      // same-id collisions are handled by importPlan, which also deletes any plan with the same id.
      if (has('plans.json') && selectedPlans.size > 0) {
        try {
          if (Array.isArray(rawPlanList)) {
            // Snapshot once so two same-name plans in this bundle don't delete each
            // other; replace by name only when non-empty.
            const existingPlans = await plans.listNames();
            for (const [pi, p] of rawPlanList.entries()) {
              if (typeof p.id !== 'string' || typeof p.name !== 'string') continue;
              if (!selectedPlans.has(p.id)) continue;
              try {
                await plans.importPlan(p, {
                  replaceIds: p.name ? idsToReplaceByName(existingPlans, p.name) : [],
                  // A setup this import skipped or kept under another id is pointed at its local twin.
                  setupId:
                    typeof p.setupId === 'string'
                      ? (setupPlan.setupIdRemap[p.setupId] ?? p.setupId)
                      : null,
                  index: pi,
                });
              } catch (planErr) {
                recordFailure('plan', p.name || p.id, planErr);
              }
            }
          }
        } catch {
          /* ignore invalid plans.json */
        }
      }

      // Copy the selected image files into the blob store (always overwrite).
      const imageNames = names.filter((n) => n.startsWith('images/') && !n.endsWith('/'));
      const writtenFiles = new Set<string>();
      // Without a selection, files are written only for the photo records this same
      // request imports (all photos of the manifest); otherwise they would belong to no photo.
      const importsPhotoRecords = importMetadata && list.length > 0;
      for (const entryName of imageNames) {
        if (selectedImages === null && !importsPhotoRecords) continue;
        const baseName = baseNameOf(entryName);
        if (!ALLOWED_PHOTO_EXTENSIONS.has(extNameOf(baseName).toLowerCase())) continue;
        if (selectedImages !== null && !selectedImages.has(baseName)) continue;
        try {
          const bytes = await reader.read(entryName);
          if (!bytes) continue;
          await blobs.put(baseName, bytes);
          writtenFiles.add(baseName);
        } catch (writeErr) {
          console.warn(`[Import] Failed to write ${baseName}:`, writeErr);
        }
      }

      const { imported, skipped } = await importPhotoRecords(
        list,
        importMetadata,
        writtenFiles,
        recordFailure,
      );
      return { imported, skipped, dsoOverridesImported, failed };
    },

    async importPhotoList(list, selection) {
      if (!Array.isArray(list)) throw invalidManifest();
      const failed: ImportFailure[] = [];
      const { imported, skipped } = await importPhotoRecords(
        list as ManifestPhoto[],
        selection.importMetadata === true,
        null,
        makeFailureRecorder(failed),
      );
      return { imported, skipped, dsoOverridesImported: 0, failed };
    },
  };
  return service;
}
