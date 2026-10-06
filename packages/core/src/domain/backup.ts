// Export / import (sky data bundle) API shapes, and the pure rules of a bundle.

import { customGearName, type GearSetupData } from './gear';

export interface ExportOptions {
  includeImages?: boolean;
  includeMetadata?: boolean;
  includeDsoOverrides?: boolean;
  includeCustomGear?: boolean;
  includeSetups?: boolean;
  includePlans?: boolean;
  includeShortcuts?: boolean;
  includePoiCategories?: boolean;
  includeSkyRegions?: boolean;
}

export interface ImportPreviewImage {
  filename: string;
  originalName: string;
  size: number;
  exists: boolean;
}

export interface ImportPreviewPlan {
  id: string;
  name: string;
  /** true if a plan with the same name already exists (will be replaced if imported). */
  exists: boolean;
  /** The setup id stored in the bundle for this plan (null when the plan has none). */
  setupId: string | null;
}

/**
 * How a setup of the bundle stands against this machine: `none` (no corresponding local setup),
 * `identical` (same name, telescope, camera and accessory) or `different`.
 */
export type SetupConflict = 'none' | 'identical' | 'different';

/** What to do with a bundle setup whose content differs from the local one. */
export type SetupImportChoice = 'replace' | 'keepBoth' | 'skip';

export interface ImportPreviewSetup {
  id: string;
  name: string;
  /** true if a setup with the same name already exists (will be replaced if imported). */
  exists: boolean;
  conflict: SetupConflict;
  /** The corresponding local setup's id (same id, else same name); absent when `conflict` is `none`. */
  localId?: string;
}

export interface ImportPreviewGear {
  id: string;
  type: string;
  name: string;
  /** true if gear of the same type + name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewResult {
  hasMetadata: boolean;
  photos: number;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPoiCategories: boolean;
  hasSkyRegions: boolean;
  hasPlans: boolean;
  hasShortcuts: boolean;
  /** Parsed shortcuts.json content, applied client-side to localStorage on import. */
  shortcuts?: unknown;
  images: ImportPreviewImage[];
  plans: ImportPreviewPlan[];
  setups: ImportPreviewSetup[];
  gear: ImportPreviewGear[];
}

/** An item of a backup that could not be restored. */
export interface ImportFailure {
  kind: 'plan' | 'setup' | 'gear' | 'photo';
  name: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  dsoOverridesImported?: number;
  /** Items that failed; the others were imported. Empty when nothing failed. */
  failed?: ImportFailure[];
}

export interface ImportOptions {
  importMetadata: boolean;
  importDsoOverrides: boolean;
  importPoiCategories?: boolean;
  importSkyRegions?: boolean;
  /** null means no image filtering (metadata-only import). */
  selectedImages: string[] | null;
  /** ids of plans to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedPlans: string[] | null;
  /** ids of gear setups to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedSetups: string[] | null;
  /** ids of custom gear to import (type+name-collisions are replaced); null/empty ⇒ none. */
  selectedGear: string[] | null;
  /** Choice per bundle setup id, for the setups whose content differs from a local one. */
  setupConflicts?: Record<string, SetupImportChoice>;
}

/** What the export asks for: the options, the photos to take (all when absent or empty) and the shortcuts to bundle. */
export interface ExportRequest {
  options?: ExportOptions;
  ids?: string[];
  /** Keyboard-shortcut bindings, which live in the client's localStorage. */
  shortcuts?: unknown;
}

// ─── Bundle rules (pure) ───────────────────────────────────────────────────────

/** The file name of an export made at `now` (UTC): `sky-export-2026-10-06-14-03-59.zip`, or `.json` for the metadata-only list. */
export function backupFileName(now: Date, extension: 'zip' | 'json' = 'zip'): string {
  const stamp = now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '-');
  return `sky-export-${stamp}.${extension}`;
}

/** UTF-8 text of some bytes; a leading byte-order mark is kept, as `Buffer.toString` does. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** The last segment of a path (either separator). */
export function baseNameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

/** The extension of a file name with its dot, or '' (a leading dot does not start one). */
export function extNameOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i);
}

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:(?:[\\/]|$)|^[\\/]{2}/;

// ─── ZIP content inspection ───────────────────────────────────────────────────

/** Minimal interface satisfied by unzipper's File entries (and test mocks). */
export interface ZipEntry {
  path: string;
  type: string;
  uncompressedSize: number;
  buffer(): Promise<Uint8Array>;
}

export interface ZipInspectResult {
  /** true if manifest.json was present and parseable (even if photos array is empty) */
  hasMetadata: boolean;
  photos: Array<{ filename: string; originalName: string; thumbFilename: string | null }>;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPoiCategories: boolean;
  hasSkyRegions: boolean;
  hasPlans: boolean;
  /** Individual night plans in plans.json (id + name), for per-item import selection. */
  planItems: Array<{ id: string; name: string }>;
  /** Individual gear setups in gear-setups.json (id + name), for per-item import selection. */
  setupItems: Array<{ id: string; name: string }>;
  /** Individual custom gear in custom-gear.json (id + type + name), for per-item import selection. */
  gearItems: Array<{ id: string; type: string; name: string }>;
  /** Image files in images/ directory, with thumbnails removed. */
  imageEntries: Array<{ filename: string; size: number }>;
}

/** An image entry as surfaced to the import-preview client. */
export interface PreviewImageEntry {
  filename: string;
  originalName: string;
  size: number;
  exists: boolean;
}

/** A plan entry as surfaced to the import-preview client. */
export interface PreviewPlanEntry {
  id: string;
  name: string;
  /** true if a plan with the same name already exists (will be replaced if imported). */
  exists: boolean;
  /** The setup id stored in the bundle (null when the plan has none). */
  setupId: string | null;
}

/** A gear-setup entry as surfaced to the import-preview client. */
export interface PreviewSetupEntry {
  id: string;
  name: string;
  /** true if a setup with the same name already exists (will be replaced if imported). */
  exists: boolean;
  conflict: SetupConflict;
  /** The corresponding local setup's id; present when `conflict` is not `none`. */
  localId?: string;
}

/** A custom-gear entry as surfaced to the import-preview client. */
export interface PreviewGearEntry {
  id: string;
  type: string;
  name: string;
  /** true if gear of the same type + name already exists (will be replaced if imported). */
  exists: boolean;
}

/** The JSON shape returned by the /api/import-preview endpoint for a ZIP bundle. */
export interface ImportPreviewResponse {
  hasMetadata: boolean;
  photos: number;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPoiCategories: boolean;
  hasSkyRegions: boolean;
  hasPlans: boolean;
  hasShortcuts: boolean;
  shortcuts?: unknown;
  images: PreviewImageEntry[];
  plans: PreviewPlanEntry[];
  setups: PreviewSetupEntry[];
  gear: PreviewGearEntry[];
}

/**
 * Maps a {@link ZipInspectResult} (plus the separately-parsed shortcuts and
 * resolved image list) into the import-preview response sent to the client.
 *
 * Kept pure and exported so it is unit-testable: the endpoint in server/index.ts
 * is excluded from coverage, and this mapping is exactly where a `has*` flag can
 * be silently dropped on its way to the client.
 */
export function buildZipPreviewResponse(
  inspect: ZipInspectResult,
  extra: {
    hasShortcuts: boolean;
    shortcuts?: unknown;
    images: PreviewImageEntry[];
    plans: PreviewPlanEntry[];
    setups: PreviewSetupEntry[];
    gear: PreviewGearEntry[];
  },
): ImportPreviewResponse {
  return {
    hasMetadata: inspect.hasMetadata && inspect.photos.length > 0,
    photos: inspect.photos.length,
    hasDsoOverrides: inspect.hasDsoOverrides,
    hasCustomGear: inspect.hasCustomGear,
    hasSetups: inspect.hasSetups,
    hasPoiCategories: inspect.hasPoiCategories,
    hasSkyRegions: inspect.hasSkyRegions,
    hasPlans: inspect.hasPlans,
    hasShortcuts: extra.hasShortcuts,
    shortcuts: extra.shortcuts,
    images: extra.images,
    plans: extra.plans,
    setups: extra.setups,
    gear: extra.gear,
  };
}

/**
 * Returns the ids of existing rows whose `name` collides with the given name.
 * Used to resolve name-based override on import: a selected plan/setup/gear whose
 * name already exists replaces the existing row(s) rather than duplicating them.
 *
 * Custom-gear callers pre-filter `existing` to the same `type` before calling,
 * since a telescope and an accessory may legitimately share a name.
 */
export function idsToReplaceByName(
  existing: readonly { id: string; name: string }[],
  name: string,
): string[] {
  return existing.filter((e) => e.name === name).map((e) => e.id);
}

// ─── Setups: what an import does with them ────────────────────────────────────

/**
 * The importable setups of a `gear-setups.json`: those with a string id, telescope id and camera id.
 * A missing name becomes `''`, a missing accessory `null`, and `enabled` is true unless it is `false`.
 */
export function parseBundleSetups(raw: unknown): GearSetupData[] {
  if (!Array.isArray(raw)) return [];
  const out: GearSetupData[] = [];
  for (const s of raw) {
    if (
      typeof s?.id === 'string' &&
      typeof s.telescopeId === 'string' &&
      typeof s.cameraId === 'string'
    ) {
      out.push({
        id: s.id,
        name: typeof s.name === 'string' ? s.name : '',
        telescopeId: s.telescopeId,
        cameraId: s.cameraId,
        accessoryId: typeof s.accessoryId === 'string' ? s.accessoryId : null,
        enabled: s.enabled !== false,
      });
    }
  }
  return out;
}

/** The setup id each plan of a `plans.json` points at (null when it has none), by plan id. */
export function parseBundlePlanSetupIds(
  raw: unknown,
): Array<{ id: string; setupId: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; setupId: string | null }> = [];
  for (const p of raw) {
    if (typeof p?.id === 'string') {
      out.push({ id: p.id, setupId: typeof p.setupId === 'string' ? p.setupId : null });
    }
  }
  return out;
}

/**
 * How a setup of the bundle stands against the local setups. The corresponding local setup is the one
 * with the same id, failing that the first with the same non-empty name. Two corresponding setups are
 * identical when name, telescope, camera and accessory are equal (`enabled` is not compared).
 */
export function classifyBundleSetup(
  bundle: GearSetupData,
  locals: readonly GearSetupData[],
): { conflict: SetupConflict; localId?: string } {
  const local =
    locals.find((l) => l.id === bundle.id) ??
    (bundle.name ? locals.find((l) => l.name === bundle.name) : undefined);
  if (!local) return { conflict: 'none' };
  const identical =
    local.name === bundle.name &&
    local.telescopeId === bundle.telescopeId &&
    local.cameraId === bundle.cameraId &&
    (local.accessoryId ?? null) === (bundle.accessoryId ?? null);
  return { conflict: identical ? 'identical' : 'different', localId: local.id };
}

export interface SetupImportAction {
  /** The setup's id in the bundle. */
  bundleId: string;
  conflict: SetupConflict;
  /**
   * `import`: a setup with no local counterpart, written as is. `replace` / `keepBoth`: a different
   * setup, written over the local one / under a new id. `useLocal`: an identical setup, nothing written.
   * `skip`: a different setup left out.
   */
  action: 'import' | 'replace' | 'keepBoth' | 'useLocal' | 'skip';
  /** The setup to write (`import`, `replace`, `keepBoth`); absent otherwise. */
  setup?: GearSetupData;
  /** Local setups to delete before the write. */
  replaceIds: string[];
}

export interface SetupImportPlan {
  /** One entry per setup the import handles, in the bundle's order. */
  actions: SetupImportAction[];
  /** For the plans of this import: bundle setup id to the id they must point at (only ids that change). */
  setupIdRemap: Record<string, string>;
  /** Custom gear the written setups use, present in the bundle and absent here, and not already selected. */
  extraGearIds: string[];
}

const SETUP_CHOICES: readonly string[] = ['replace', 'keepBoth', 'skip'];

/**
 * Decides what an import does with the setups of a bundle. A setup is handled when it is ticked or is
 * the setup of a ticked plan. With no local counterpart it is imported; an identical one is left alone
 * and the plans are pointed at the local setup; a different one follows the user's choice (no choice:
 * `replace` when ticked, `skip` when only a plan pulled it in). Plans that are not ticked pull nothing.
 * The custom gear a written setup uses, when it is in the bundle and absent here, is imported too.
 */
export function planSetupImportActions(input: {
  bundleSetups: readonly GearSetupData[];
  bundlePlans: ReadonlyArray<{ id: string; setupId: string | null }>;
  bundleGearIds: Iterable<string>;
  selectedPlans: ReadonlySet<string>;
  selectedSetups: ReadonlySet<string>;
  selectedGear: ReadonlySet<string>;
  choices: Readonly<Record<string, string>>;
  localSetups: readonly GearSetupData[];
  localGearIds: ReadonlySet<string>;
  /** A fresh unique id (without the `setup-` prefix). */
  newId: () => string;
}): SetupImportPlan {
  const requiredByPlan = new Set<string>();
  for (const p of input.bundlePlans) {
    if (input.selectedPlans.has(p.id) && p.setupId) requiredByPlan.add(p.setupId);
  }
  const bundleGearIds = new Set(input.bundleGearIds);
  const actions: SetupImportAction[] = [];
  const setupIdRemap: Record<string, string> = {};
  const extraGearIds = new Set<string>();
  const handled = new Set<string>();

  for (const setup of input.bundleSetups) {
    if (handled.has(setup.id)) continue;
    const ticked = input.selectedSetups.has(setup.id);
    if (!ticked && !requiredByPlan.has(setup.id)) continue;
    handled.add(setup.id);

    const { conflict, localId } = classifyBundleSetup(setup, input.localSetups);
    const base = { bundleId: setup.id, conflict, replaceIds: [] as string[] };
    let action: SetupImportAction;
    if (conflict === 'none') {
      action = { ...base, action: 'import', setup };
    } else if (conflict === 'identical') {
      action = { ...base, action: 'useLocal' };
      if (localId && localId !== setup.id) setupIdRemap[setup.id] = localId;
    } else {
      const sent = input.choices[setup.id];
      const choice = SETUP_CHOICES.includes(sent) ? sent : ticked ? 'replace' : 'skip';
      if (choice === 'replace') {
        const replaceIds = new Set<string>(localId ? [localId] : []);
        if (setup.name) {
          idsToReplaceByName(input.localSetups, setup.name).forEach((id) => replaceIds.add(id));
        }
        action = { ...base, action: 'replace', setup, replaceIds: [...replaceIds] };
      } else if (choice === 'keepBoth') {
        const id = `setup-${input.newId()}`;
        action = {
          ...base,
          action: 'keepBoth',
          setup: { ...setup, id, name: `${setup.name} (import)` },
        };
        setupIdRemap[setup.id] = id;
      } else {
        action = { ...base, action: 'skip' };
        if (localId && localId !== setup.id) setupIdRemap[setup.id] = localId;
      }
    }
    actions.push(action);

    if (action.setup) {
      for (const gid of [setup.telescopeId, setup.cameraId, setup.accessoryId]) {
        if (
          gid &&
          bundleGearIds.has(gid) &&
          !input.localGearIds.has(gid) &&
          !input.selectedGear.has(gid)
        ) {
          extraGearIds.add(gid);
        }
      }
    }
  }
  return { actions, setupIdRemap, extraGearIds: [...extraGearIds] };
}

const ALLOWED_IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.fits', '.webp']);

/**
 * Inspects the logical contents of a ZIP bundle without touching the DB or filesystem.
 * Accepts any iterable of ZipEntry (unzipper File entries or test mocks).
 */
export async function inspectZipContents(entries: ZipEntry[]): Promise<ZipInspectResult> {
  const result: ZipInspectResult = {
    hasMetadata: false,
    photos: [],
    hasDsoOverrides: false,
    hasCustomGear: false,
    hasSetups: false,
    hasPoiCategories: false,
    hasSkyRegions: false,
    hasPlans: false,
    planItems: [],
    setupItems: [],
    gearItems: [],
    imageEntries: [],
  };

  let manifestBuffer: Uint8Array | null = null;
  const rawImageEntries: Array<{ filename: string; size: number }> = [];

  for (const entry of entries) {
    if (entry.type !== 'File') continue;

    if (entry.path === 'manifest.json') {
      manifestBuffer = await entry.buffer();
    } else if (entry.path === 'dso-overrides.json') {
      try {
        const overrides = JSON.parse(decodeUtf8(await entry.buffer()));
        if (
          typeof overrides === 'object' &&
          !Array.isArray(overrides) &&
          Object.keys(overrides).length > 0
        ) {
          result.hasDsoOverrides = true;
        }
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'custom-gear.json') {
      try {
        const gear = JSON.parse(decodeUtf8(await entry.buffer()));
        if (Array.isArray(gear) && gear.length > 0) {
          result.hasCustomGear = true;
          for (const g of gear) {
            if (typeof g?.id === 'string' && typeof g?.type === 'string') {
              result.gearItems.push({
                id: g.id,
                type: g.type,
                name: customGearName(g.type, g, g.id),
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'gear-setups.json') {
      try {
        const setups = JSON.parse(decodeUtf8(await entry.buffer()));
        if (Array.isArray(setups) && setups.length > 0) {
          result.hasSetups = true;
          for (const s of setups) {
            if (typeof s?.id === 'string') {
              result.setupItems.push({
                id: s.id,
                name: typeof s.name === 'string' ? s.name : s.id,
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'poi-categories.json') {
      try {
        const cats = JSON.parse(decodeUtf8(await entry.buffer()));
        if (Array.isArray(cats) && cats.length > 0) result.hasPoiCategories = true;
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'sky-regions.json') {
      try {
        const regions = JSON.parse(decodeUtf8(await entry.buffer()));
        if (Array.isArray(regions) && regions.length > 0) result.hasSkyRegions = true;
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'plans.json') {
      try {
        const plans = JSON.parse(decodeUtf8(await entry.buffer()));
        if (Array.isArray(plans) && plans.length > 0) {
          result.hasPlans = true;
          for (const p of plans) {
            if (typeof p?.id === 'string') {
              result.planItems.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id });
            }
          }
        }
      } catch {
        /* ignore */
      }
    } else if (entry.path.startsWith('images/')) {
      const baseName = baseNameOf(entry.path);
      if (ALLOWED_IMG_EXT.has(extNameOf(baseName).toLowerCase())) {
        rawImageEntries.push({ filename: baseName, size: entry.uncompressedSize });
      }
    }
  }

  if (manifestBuffer) {
    try {
      const photos = parseManifestPhotos(JSON.parse(decodeUtf8(manifestBuffer)));
      result.hasMetadata = true;
      const thumbSet = new Set<string>();
      for (const p of photos as any[]) {
        if (typeof p.thumbFilename === 'string' && p.thumbFilename) thumbSet.add(p.thumbFilename);
        result.photos.push({
          filename: p.filename ?? '',
          originalName: p.originalName ?? p.filename ?? p.id ?? '',
          thumbFilename:
            typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null,
        });
      }
      result.imageEntries = rawImageEntries.filter((e) => !thumbSet.has(e.filename));
    } catch {
      /* ignore invalid manifest */
    }
  } else {
    result.imageEntries = rawImageEntries;
  }

  return result;
}

/**
 * Validates that a ZIP entry path does not attempt directory traversal.
 * Rejects paths that contain '..' segments or are absolute.
 * Used server-side before extracting any ZIP entry to UPLOADS_DIR.
 */
export function isValidZipEntryPath(entryPath: string): boolean {
  if (typeof entryPath !== 'string' || entryPath.length === 0) return false;
  if (entryPath.includes('\0')) return false;

  const unified = entryPath.replace(/\\/g, '/');
  if (unified.startsWith('/') || WINDOWS_ABSOLUTE_RE.test(unified) || unified.startsWith('//')) {
    return false;
  }

  // Check segments before normalizing — path.posix.normalize resolves '..' away,
  // which would make 'images/../secret' pass the check when it should not.
  const segments = unified.split('/');
  if (segments.includes('..')) return false;

  // Without a '..' segment, normalising the path cannot make it climb out of its folder.
  return true;
}

/**
 * Parse the manifest from an import bundle.
 *
 * Supports two formats:
 *   - Legacy: a plain JSON array of photo objects (manifestVersion absent)
 *   - Current: `{ manifestVersion: 1, photos: [...] }`
 *
 * Returns the photos array, or an empty array for unrecognised input.
 */
export function parseManifestPhotos(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.photos)) return obj.photos;
  }
  return [];
}
