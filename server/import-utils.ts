import path from 'path';

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:(?:[\\/]|$)|^[\\/]{2}/;

// ─── ZIP content inspection ───────────────────────────────────────────────────

/** Minimal interface satisfied by unzipper's File entries (and test mocks). */
export interface ZipEntry {
  path: string;
  type: string;
  uncompressedSize: number;
  buffer(): Promise<Buffer>;
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
}

/** A gear-setup entry as surfaced to the import-preview client. */
export interface PreviewSetupEntry {
  id: string;
  name: string;
  /** true if a setup with the same name already exists (will be replaced if imported). */
  exists: boolean;
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
  existing: { id: string; name: string }[],
  name: string,
): string[] {
  return existing.filter((e) => e.name === name).map((e) => e.id);
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

  let manifestBuffer: Buffer | null = null;
  const rawImageEntries: Array<{ filename: string; size: number }> = [];

  for (const entry of entries) {
    if (entry.type !== 'File') continue;

    if (entry.path === 'manifest.json') {
      manifestBuffer = await entry.buffer();
    } else if (entry.path === 'dso-overrides.json') {
      try {
        const overrides = JSON.parse((await entry.buffer()).toString('utf8'));
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
        const gear = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(gear) && gear.length > 0) {
          result.hasCustomGear = true;
          for (const g of gear) {
            if (typeof g?.id === 'string' && typeof g?.type === 'string') {
              result.gearItems.push({
                id: g.id,
                type: g.type,
                name: typeof g.name === 'string' ? g.name : g.id,
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'gear-setups.json') {
      try {
        const setups = JSON.parse((await entry.buffer()).toString('utf8'));
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
        const cats = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(cats) && cats.length > 0) result.hasPoiCategories = true;
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'sky-regions.json') {
      try {
        const regions = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(regions) && regions.length > 0) result.hasSkyRegions = true;
      } catch {
        /* ignore */
      }
    } else if (entry.path === 'plans.json') {
      try {
        const plans = JSON.parse((await entry.buffer()).toString('utf8'));
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
      const baseName = path.basename(entry.path);
      if (ALLOWED_IMG_EXT.has(path.extname(baseName).toLowerCase())) {
        rawImageEntries.push({ filename: baseName, size: entry.uncompressedSize });
      }
    }
  }

  if (manifestBuffer) {
    try {
      const photos = parseManifestPhotos(JSON.parse(manifestBuffer.toString('utf8')));
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

  // Normalize after the segment check to catch redundant '.' sequences that
  // could combine into an escape (defence-in-depth).
  const normalized = path.posix.normalize(unified);
  return !normalized.startsWith('../') && normalized !== '..';
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

/**
 * Validate RA and Dec fields in a DSO override payload.
 * Returns `{ error, code }` if any value is out of range, otherwise null.
 *
 * Ranges: RA ∈ [0, 360), Dec ∈ [−90, 90].
 */
export function validateDsoOverrideCoords(
  data: Record<string, unknown>,
): { error: string; code: string } | null {
  if (typeof data.ra === 'number' && (data.ra < 0 || data.ra >= 360)) {
    return { error: 'RA must be in [0, 360)', code: 'INVALID_DSO_RA' };
  }
  if (typeof data.dec === 'number' && (data.dec < -90 || data.dec > 90)) {
    return { error: 'Dec must be in [-90, 90]', code: 'INVALID_DSO_DEC' };
  }
  return null;
}
