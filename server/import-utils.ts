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
  hasPlans: boolean;
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

/** The JSON shape returned by the /api/import-preview endpoint for a ZIP bundle. */
export interface ImportPreviewResponse {
  hasMetadata: boolean;
  photos: number;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPlans: boolean;
  hasShortcuts: boolean;
  shortcuts?: unknown;
  images: PreviewImageEntry[];
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
  extra: { hasShortcuts: boolean; shortcuts?: unknown; images: PreviewImageEntry[] },
): ImportPreviewResponse {
  return {
    hasMetadata: inspect.hasMetadata && inspect.photos.length > 0,
    photos: inspect.photos.length,
    hasDsoOverrides: inspect.hasDsoOverrides,
    hasCustomGear: inspect.hasCustomGear,
    hasSetups: inspect.hasSetups,
    hasPlans: inspect.hasPlans,
    hasShortcuts: extra.hasShortcuts,
    shortcuts: extra.shortcuts,
    images: extra.images,
  };
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
    hasPlans: false,
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
        if (typeof overrides === 'object' && !Array.isArray(overrides) && Object.keys(overrides).length > 0) {
          result.hasDsoOverrides = true;
        }
      } catch { /* ignore */ }
    } else if (entry.path === 'custom-gear.json') {
      try {
        const gear = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(gear) && gear.length > 0) result.hasCustomGear = true;
      } catch { /* ignore */ }
    } else if (entry.path === 'gear-setups.json') {
      try {
        const setups = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(setups) && setups.length > 0) result.hasSetups = true;
      } catch { /* ignore */ }
    } else if (entry.path === 'plans.json') {
      try {
        const plans = JSON.parse((await entry.buffer()).toString('utf8'));
        if (Array.isArray(plans) && plans.length > 0) result.hasPlans = true;
      } catch { /* ignore */ }
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
          thumbFilename: typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null,
        });
      }
      result.imageEntries = rawImageEntries.filter(e => !thumbSet.has(e.filename));
    } catch { /* ignore invalid manifest */ }
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
