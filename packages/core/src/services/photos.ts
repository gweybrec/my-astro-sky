/**
 * Photos, the data part: the `photos` and `star_correspondences` rows, the checks of the upload form and of
 * the metadata, placement and order routes, and the rules that clean what is stored. Image and file work
 * (reading the picture, writing it to disk, thumbnails) is not here: the route still does it.
 * A photo's correspondences are deleted with it by `ON DELETE CASCADE` (foreign keys must be on).
 */
import { DomainError } from '../domain/errors';
import type {
  BackupPhoto,
  PhotoUploadFile,
  PhotoUploadResult,
  PhotoWithSize,
  ManualPlacementInput,
  NewPhotoInput,
  PhotoCorrespondenceInput,
  PhotoImportStrategy,
  PhotoMetadataChanges,
  UploadFields,
  UploadMetadata,
} from '../domain/photos';
import type { BlobStore } from '../ports/blob-store';
import type { ImageCodec, ImageInfo } from '../ports/image-codec';
import type { SqlDb, SqlStatement, SqlValue } from '../ports/sql-db';
import type { CaptureDetails, Photo, PhotoIntegration, PointOfInterest } from '../types';
import { sanitizeCaptureDetails } from '../wcs';

/** Extensions an uploaded photo may have (lower case, with the dot). */
export const ALLOWED_PHOTO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

/** The most correspondences one upload may carry. */
export const MAX_CORRESPONDENCES = 100;

/** The longer side of a thumbnail, in pixels. */
export const THUMB_SIZE = 400;
/** The JPEG quality of a thumbnail. */
export const THUMB_QUALITY = 75;

/** The name of the thumbnail of the image file `filename` (the extension becomes `_thumb.jpg`). */
export const thumbnailNameOf = (filename: string): string =>
  filename.replace(/(\.[^.]+)$/, '_thumb.jpg');

export interface PhotoServiceDeps {
  db: SqlDb;
  newId: () => string;
  images: ImageCodec;
  blobs: BlobStore;
}

export interface PhotoService {
  /** Every photo with its correspondences, in draw order (no `fileSize`: the route adds it from the file). */
  list(): Promise<Photo[]>;
  /** One photo, or undefined when there is no such row. Same shape as an entry of `list()`. */
  get(id: string): Promise<Photo | undefined>;
  /** The name of the photo's image file, or undefined when there is no such photo. */
  fileNameOf(id: string): Promise<string | undefined>;
  /**
   * Writes the photo row (last in the draw order) and its correspondences in one atomic batch, and returns
   * the stored photo. A repeated `pointIndex` makes the whole write fail and leaves nothing behind.
   */
  insert(input: NewPhotoInput): Promise<Photo>;
  /**
   * The checks of `POST /api/photos` that need no image, in their order: the extension of `fileName`, then
   * the `correspondences` field (present, JSON, 2 to 100 items, each item valid). Returns the correspondences
   * in the form they are stored. Throws `invalid` with the codes `INVALID_EXTENSION`, `MISSING_CORRESPONDENCES`,
   * `INVALID_JSON`, `MIN_CORRESPONDENCES`, `MAX_CORRESPONDENCES`, `INVALID_POINT_INDEX`, `INVALID_PHOTO_X`,
   * `INVALID_PHOTO_Y`, `INVALID_STAR_HIP`.
   */
  validateUpload(fileName: string, fields: UploadFields): PhotoCorrespondenceInput[];
  /** Parses and cleans the other fields of the upload form; a field that does not parse falls back to its empty value. */
  readUploadMetadata(fileName: string, fields: UploadFields): UploadMetadata;
  /**
   * The whole of `POST /api/photos`, in order: the checks that need no image, the probe (`INVALID_IMAGE`), the
   * orientation baked into the stored image `<id><ext>` (`INVALID_IMAGE`), the thumbnail `<id>_thumb.jpg` (a failure
   * is a warning in the result, the upload goes on), then the insert. Files are written outside any transaction and
   * are not removed when the insert fails.
   */
  upload(file: PhotoUploadFile, fields: UploadFields): Promise<PhotoUploadResult>;
  /** The list with `fileSize` read from the blob store (null when the image is missing). */
  listWithSizes(): Promise<PhotoWithSize[]>;
  /**
   * Deletes a photo: its image and its thumbnail, then its row. Throws `notFound` (`PHOTO_NOT_FOUND`) when there is no
   * such photo.
   */
  remove(id: string): Promise<void>;
  /** Deletes the photos with these ids (files, then rows). Returns how many existed. Ids that are not strings are ignored. */
  removeMany(ids: readonly string[]): Promise<number>;
  /**
   * Makes the thumbnail `thumbFilename` from the image `filename` when the image exists and the thumbnail does not.
   * Rejects when the picture cannot be read or written; used after a backup import.
   */
  ensureThumbnail(filename: string, thumbFilename: string): Promise<void>;
  /** Replaces the metadata of a photo. Returns the cleaned `originalName` when one was given. Throws `notFound` (`PHOTO_NOT_FOUND`). */
  updateMetadata(id: string, changes: PhotoMetadataChanges): Promise<{ originalName?: string }>;
  /** Stores the placement as JSON, or clears it when `placement` is falsy. Throws `notFound` (`PHOTO_NOT_FOUND`). */
  setManualPlacement(id: string, placement: ManualPlacementInput | undefined): Promise<void>;
  /**
   * Gives every photo the draw position of its index in `photoIds`, which must hold every existing id exactly
   * once. Throws `invalid` (`INVALID_PHOTO_ORDER`).
   */
  setOrder(photoIds: readonly string[]): Promise<void>;
  /** Deletes one photo row (not its files). Returns whether there was one. */
  removeRow(id: string): Promise<boolean>;
  /** Deletes the rows with these ids (not their files). Returns how many existed. Ids that are not strings are ignored. */
  removeRows(ids: readonly string[]): Promise<number>;
  /** Deletes every photo row (not the files). Returns how many there were. */
  removeAllRows(): Promise<number>;
  /** Deletes every photo: the rows, the images and the thumbnails. Returns how many there were. */
  removeAll(): Promise<number>;
  /** For each of `names` that is the display name of a stored photo, the id of that photo (the first one), in the order of `names`. */
  findByOriginalNames(names: readonly string[]): Promise<{ originalName: string; id: string }[]>;
  /**
   * Writes one photo of a backup manifest in one transaction, with the id it has there. With `skip` an existing
   * id is left alone ('skipped'); with `replace` it is deleted first.
   */
  importPhoto(photo: BackupPhoto, strategy: PhotoImportStrategy): Promise<'imported' | 'skipped'>;
}

interface PhotoRow {
  id: string;
  filename: string;
  original_name: string;
  width: number;
  height: number;
  created_at: string;
  manual_placement: string | null;
  dso_ids: string | null;
  labels: string | null;
  points_of_interest: string | null;
  notes: string | null;
  integrations: string | null;
  thumb_filename: string | null;
  observation_date: string | null;
  capture_details: string | null;
  gear_setup_id: string | null;
}

interface CorrespondenceRow {
  photo_id: string;
  point_index: number;
  photo_x: number;
  photo_y: number;
  star_hip: number;
  star_name: string;
  star_ra: number | null;
  star_dec: number | null;
}

const INSERT_PHOTO = `INSERT INTO photos (id, filename, original_name, width, height, manual_placement, dso_ids, labels, points_of_interest, notes, integrations, display_order, thumb_filename, observation_date, capture_details, gear_setup_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?, ?, ?)`;
const INSERT_PHOTO_WITH_ID = `INSERT OR IGNORE INTO photos (id, filename, original_name, width, height, created_at, manual_placement, dso_ids, labels, points_of_interest, notes, integrations, display_order, thumb_filename, observation_date, capture_details, gear_setup_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(display_order) + 1 FROM photos), 0), ?, ?, ?, ?)`;
const INSERT_CORRESPONDENCE =
  'INSERT INTO star_correspondences (photo_id, point_index, photo_x, photo_y, star_hip, star_name, star_ra, star_dec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const SELECT_PHOTOS = 'SELECT * FROM photos ORDER BY display_order ASC, created_at ASC, id ASC';
const SELECT_PHOTO = 'SELECT * FROM photos WHERE id = ?';
const SELECT_CORRESPONDENCES = 'SELECT * FROM star_correspondences ORDER BY point_index';
const SELECT_CORRESPONDENCES_FOR =
  'SELECT * FROM star_correspondences WHERE photo_id = ? ORDER BY point_index';
const SELECT_FILENAME = 'SELECT filename FROM photos WHERE id = ?';
const SELECT_IDS = 'SELECT id FROM photos';
const SELECT_IDS_FILENAMES = 'SELECT id, filename FROM photos';
const SELECT_NAMES = 'SELECT id, original_name FROM photos ORDER BY rowid ASC';
const DELETE_PHOTO = 'DELETE FROM photos WHERE id = ?';
const DELETE_ALL_PHOTOS = 'DELETE FROM photos';
const UPDATE_PLACEMENT = 'UPDATE photos SET manual_placement = ? WHERE id = ?';
const UPDATE_METADATA =
  'UPDATE photos SET dso_ids = ?, labels = ?, points_of_interest = ?, notes = ?, integrations = ?, observation_date = ?, capture_details = ?, gear_setup_id = ? WHERE id = ?';
const UPDATE_METADATA_WITH_NAME =
  'UPDATE photos SET dso_ids = ?, labels = ?, points_of_interest = ?, notes = ?, integrations = ?, observation_date = ?, capture_details = ?, gear_setup_id = ?, original_name = ? WHERE id = ?';
const UPDATE_DRAW_ORDER = 'UPDATE photos SET display_order = ? WHERE id = ?';

const photoNotFoundBody = { error: 'Photo introuvable', code: 'PHOTO_NOT_FOUND' } as const;

/** The error for a photo id with no row; the routes also send it when `fileNameOf` finds nothing. */
export const photoNotFound = (): DomainError =>
  new DomainError('notFound', photoNotFoundBody.error, {
    code: photoNotFoundBody.code,
    body: photoNotFoundBody,
  });

const invalidUpload = (message: string, code: string): DomainError =>
  new DomainError('invalid', message, { code, body: { error: message, code } });

const invalidOrder = (message: string): DomainError =>
  new DomainError('invalid', message, {
    code: 'INVALID_PHOTO_ORDER',
    body: { error: message, code: 'INVALID_PHOTO_ORDER' },
  });

/**
 * Accept only well-formed POI entries: a non-empty trimmed name (≤100 chars) and a
 * string categoryId. Orphan categoryIds (category since deleted) are preserved — the
 * UI resolves them to an "Uncategorized" group at render time. An optional ra/dec
 * position is kept only when both are finite and in range.
 */
export function sanitizePois(rows: unknown): PointOfInterest[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry: any) => {
      const poi: PointOfInterest = {
        name: typeof entry?.name === 'string' ? entry.name.trim().slice(0, 100) : '',
        categoryId: typeof entry?.categoryId === 'string' ? entry.categoryId.slice(0, 64) : '',
      };
      const ra = entry?.ra;
      const dec = entry?.dec;
      if (
        typeof ra === 'number' &&
        typeof dec === 'number' &&
        Number.isFinite(ra) &&
        Number.isFinite(dec) &&
        ra >= 0 &&
        ra < 360 &&
        dec >= -90 &&
        dec <= 90
      ) {
        poi.ra = ra;
        poi.dec = dec;
      }
      return poi;
    })
    .filter((entry) => entry.name.length > 0 && entry.categoryId.length > 0);
}

/**
 * Integration rows as they are stored and returned: each row is read as whole numbers and a trimmed filter,
 * and a row without at least one frame, one second and a filter is dropped.
 */
export function sanitizeIntegrationRows(rows: unknown): PhotoIntegration[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry: any) => ({
      frames: Number.isInteger(Number(entry?.frames)) ? Number(entry.frames) : 0,
      seconds: Number.isInteger(Number(entry?.seconds)) ? Number(entry.seconds) : 0,
      filter: typeof entry?.filter === 'string' ? entry.filter.trim() : '',
    }))
    .filter((entry) => entry.frames >= 1 && entry.seconds >= 1 && entry.filter.length > 0);
}

/** The extension of a file name, lower-cased, with its dot ('' when there is none). Both slashes separate folders. */
function extensionOf(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || base === '..') return '';
  return base.slice(dot).toLowerCase();
}

/** A string FK (gear setup id) trimmed to a bounded value, or null. */
function cleanSetupId(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, 64) : null;
}

function parseJsonArray(val: string | null): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSanitized<T>(val: string | null, sanitize: (v: unknown) => T, empty: T): T {
  if (!val) return empty;
  try {
    return sanitize(JSON.parse(val));
  } catch {
    return empty;
  }
}

/**
 * The one place that turns a `photos` row (plus its correspondence rows) into the API shape: the list, the
 * single read and the upload response all go through here, so they can never drift. A new metadata column is
 * wired in here once.
 */
function rowToPhoto(p: PhotoRow, corr: readonly CorrespondenceRow[]): Photo {
  return {
    id: p.id,
    filename: p.filename,
    originalName: p.original_name,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    ...(p.manual_placement ? { manualPlacement: JSON.parse(p.manual_placement) } : {}),
    dsoIds: parseJsonArray(p.dso_ids),
    labels: parseJsonArray(p.labels),
    pointsOfInterest: parseSanitized(p.points_of_interest, sanitizePois, []),
    notes: p.notes ?? '',
    integrations: parseSanitized(p.integrations, sanitizeIntegrationRows, []),
    observationDate: p.observation_date ?? null,
    captureDetails: parseSanitized(p.capture_details, sanitizeCaptureDetails, {}),
    gearSetupId: p.gear_setup_id ?? null,
    thumbFilename: p.thumb_filename ?? null,
    correspondences: corr.map((c) => ({
      pointIndex: c.point_index,
      photoX: c.photo_x,
      photoY: c.photo_y,
      starHip: c.star_hip,
      starName: c.star_name,
      ...(c.star_ra != null ? { starRa: c.star_ra } : {}),
      ...(c.star_dec != null ? { starDec: c.star_dec } : {}),
    })),
  };
}

function correspondenceStatements(
  photoId: string,
  correspondences: readonly PhotoCorrespondenceInput[],
): SqlStatement[] {
  return correspondences.map((c) => ({
    sql: INSERT_CORRESPONDENCE,
    params: [
      photoId,
      c.pointIndex,
      c.photoX,
      c.photoY,
      c.starHip,
      c.starName,
      c.starRa ?? null,
      c.starDec ?? null,
    ] as SqlValue[],
  }));
}

export function createPhotoService(deps: PhotoServiceDeps): PhotoService {
  const { db, newId, images, blobs } = deps;

  async function readOne(id: string): Promise<Photo | undefined> {
    const row = await db.get<PhotoRow>(SELECT_PHOTO, [id]);
    if (!row) return undefined;
    return rowToPhoto(row, await db.all<CorrespondenceRow>(SELECT_CORRESPONDENCES_FOR, [id]));
  }

  const service: PhotoService = {
    async list() {
      const photos = await db.all<PhotoRow>(SELECT_PHOTOS);
      const byPhoto = new Map<string, CorrespondenceRow[]>();
      for (const c of await db.all<CorrespondenceRow>(SELECT_CORRESPONDENCES)) {
        const list = byPhoto.get(c.photo_id) ?? [];
        list.push(c);
        byPhoto.set(c.photo_id, list);
      }
      return photos.map((p) => rowToPhoto(p, byPhoto.get(p.id) ?? []));
    },

    get: readOne,

    async fileNameOf(id) {
      return (await db.get<{ filename: string }>(SELECT_FILENAME, [id]))?.filename;
    },

    async upload(file, fields) {
      // The checks that need no image (extension, correspondences), in their order.
      const correspondences = service.validateUpload(file.name, fields ?? {});
      const fileExt = extensionOf(file.name);

      // Reading the size fails for a file that is not an image.
      let source: ImageInfo;
      try {
        source = await images.probe(file.bytes);
      } catch {
        throw invalidUpload('Fichier image invalide ou corrompu', 'INVALID_IMAGE');
      }
      // The browser shows the picture with its EXIF rotation applied: orientations 5 to 8 swap width and height.
      const swap = !!source.orientation && source.orientation >= 5 && source.orientation <= 8;
      const width = swap ? source.height : source.width;
      const height = swap ? source.width : source.height;

      // The orientation is baked into the stored file, which keeps the coordinate space consistent.
      const id = newId();
      const filename = `${id}${fileExt || '.jpg'}`;
      let baked: Uint8Array;
      try {
        baked = await images.bakeOrientation(file.bytes, fileExt || '.jpg');
        await blobs.put(filename, baked);
      } catch {
        throw invalidUpload(
          "Impossible de traiter l'image (format non supporté ou fichier corrompu)",
          'INVALID_IMAGE',
        );
      }

      const warnings: PhotoUploadResult['warnings'] = [];
      const thumbFilename = `${id}_thumb.jpg`;
      try {
        await blobs.put(thumbFilename, await images.thumbnail(baked, THUMB_SIZE, THUMB_QUALITY));
      } catch (error) {
        warnings.push({ code: 'THUMBNAIL_FAILED', error });
      }

      const meta = service.readUploadMetadata(file.name, fields ?? {});
      let photo: Photo;
      try {
        photo = await service.insert({
          id,
          filename,
          originalName: meta.displayName,
          width,
          height,
          correspondences,
          manualPlacement: meta.manualPlacement,
          dsoIds: meta.dsoIds,
          labels: meta.labels,
          notes: meta.notes,
          integrations: meta.integrations,
          thumbFilename,
          observationDate: meta.observationDate,
          pointsOfInterest: meta.pointsOfInterest,
          captureDetails: meta.captureDetails,
          gearSetupId: meta.gearSetupId,
        });
      } catch (error) {
        // Nothing refers to the files of this upload any more: do not leave them behind.
        await blobs.remove(filename).catch(() => undefined);
        await blobs.remove(thumbFilename).catch(() => undefined);
        throw error;
      }
      return {
        photo,
        source: {
          width: source.width,
          height: source.height,
          ...(source.orientation ? { orientation: source.orientation } : {}),
        },
        warnings,
      };
    },

    async listWithSizes() {
      const list = await service.list();
      const sizes = await Promise.all(list.map((p) => blobs.size(p.filename).catch(() => null)));
      return list.map((p, i) => ({ ...p, fileSize: sizes[i] }));
    },

    async remove(id) {
      const filename = await service.fileNameOf(id);
      if (!filename) throw photoNotFound();
      await blobs.remove(filename);
      await blobs.remove(thumbnailNameOf(filename));
      await service.removeRow(id);
    },

    async removeMany(ids) {
      const wanted = new Set(ids.filter((id): id is string => typeof id === 'string'));
      if (wanted.size === 0) return 0;
      const doomed = (await db.all<{ id: string; filename: string }>(SELECT_IDS_FILENAMES)).filter(
        (r) => wanted.has(r.id),
      );
      for (const r of doomed) {
        await blobs.remove(r.filename);
        await blobs.remove(thumbnailNameOf(r.filename));
      }
      return service.removeRows(doomed.map((r) => r.id));
    },

    async ensureThumbnail(filename, thumbFilename) {
      if ((await blobs.size(filename)) === null || (await blobs.size(thumbFilename)) !== null) {
        return;
      }
      const bytes = await blobs.get(filename);
      if (!bytes) return;
      await blobs.put(thumbFilename, await images.thumbnail(bytes, THUMB_SIZE, THUMB_QUALITY));
    },

    async insert(input) {
      await db.batch([
        {
          sql: INSERT_PHOTO,
          params: [
            input.id,
            input.filename,
            input.originalName,
            input.width,
            input.height,
            input.manualPlacement ?? null,
            JSON.stringify(input.dsoIds ?? []),
            JSON.stringify(input.labels ?? []),
            JSON.stringify(sanitizePois(input.pointsOfInterest ?? [])),
            input.notes ?? '',
            JSON.stringify(sanitizeIntegrationRows(input.integrations ?? [])),
            input.thumbFilename ?? null,
            input.observationDate ?? null,
            JSON.stringify(sanitizeCaptureDetails(input.captureDetails ?? {})),
            cleanSetupId(input.gearSetupId),
          ],
        },
        ...correspondenceStatements(input.id, input.correspondences),
      ]);
      return (await readOne(input.id))!;
    },

    validateUpload(fileName, fields) {
      const ext = extensionOf(fileName);
      if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
        throw invalidUpload(`Extension non autorisée : ${ext}`, 'INVALID_EXTENSION');
      }
      const corrJson = fields?.correspondences;
      if (!corrJson) throw invalidUpload('Correspondances manquantes', 'MISSING_CORRESPONDENCES');

      let correspondences: any[];
      try {
        correspondences = JSON.parse(corrJson);
      } catch {
        throw invalidUpload('JSON des correspondances invalide', 'INVALID_JSON');
      }
      if (!Array.isArray(correspondences) || correspondences.length < 2) {
        throw invalidUpload('Au moins 2 correspondances requises', 'MIN_CORRESPONDENCES');
      }
      if (correspondences.length > MAX_CORRESPONDENCES) {
        throw invalidUpload(
          `Trop de correspondances (max ${MAX_CORRESPONDENCES})`,
          'MAX_CORRESPONDENCES',
        );
      }

      // Validate each correspondence field
      for (const c of correspondences) {
        if (!Number.isInteger(c.pointIndex) || c.pointIndex < 0) {
          throw invalidUpload('pointIndex invalide (entier >= 0 attendu)', 'INVALID_POINT_INDEX');
        }
        if (typeof c.photoX !== 'number' || !Number.isFinite(c.photoX) || c.photoX < 0) {
          throw invalidUpload('photoX invalide (nombre positif attendu)', 'INVALID_PHOTO_X');
        }
        if (typeof c.photoY !== 'number' || !Number.isFinite(c.photoY) || c.photoY < 0) {
          throw invalidUpload('photoY invalide (nombre positif attendu)', 'INVALID_PHOTO_Y');
        }
        // starHip=0 is allowed when starRa/starDec are provided (direct RA/Dec input)
        if (c.starHip === 0) {
          if (
            typeof c.starRa !== 'number' ||
            !Number.isFinite(c.starRa) ||
            typeof c.starDec !== 'number' ||
            !Number.isFinite(c.starDec)
          ) {
            throw invalidUpload('starRa/starDec requis quand starHip=0', 'INVALID_STAR_HIP');
          }
        } else if (!Number.isInteger(c.starHip) || c.starHip <= 0) {
          throw invalidUpload('starHip invalide (entier positif attendu)', 'INVALID_STAR_HIP');
        }
      }

      // The table has UNIQUE(photo_id, point_index): refuse a repeat before any file is written.
      if (new Set(correspondences.map((c) => c.pointIndex)).size !== correspondences.length) {
        throw invalidUpload('pointIndex en double', 'DUPLICATE_POINT_INDEX');
      }

      return correspondences.map((c) => ({
        pointIndex: c.pointIndex,
        photoX: c.photoX,
        photoY: c.photoY,
        starHip: c.starHip,
        starName: c.starName || '',
        starRa: c.starRa ?? null,
        starDec: c.starDec ?? null,
      }));
    },

    readUploadMetadata(fileName, fields) {
      const f = (fields ?? {}) as Record<string, any>;

      // The stored image has the size the browser showed, so the placement scale is 1; a placement without
      // `projPerPx` becomes NaN, which JSON stores as null.
      let manualPlacement: string | null = null;
      if (f.manualPlacement) {
        try {
          const placement = JSON.parse(f.manualPlacement);
          manualPlacement = JSON.stringify({ ...placement, projPerPx: placement.projPerPx / 1 });
        } catch {
          // Invalid JSON, ignore
        }
      }

      let dsoIds: string[] = [];
      let labels: string[] = [];
      let pointsOfInterest: PointOfInterest[] = [];
      let integrations: PhotoIntegration[] = [];
      let captureDetails: CaptureDetails = {};
      try {
        dsoIds = JSON.parse(f.dsoIds || '[]');
        if (!Array.isArray(dsoIds)) dsoIds = [];
      } catch {
        dsoIds = [];
      }
      try {
        labels = JSON.parse(f.labels || '[]');
        if (!Array.isArray(labels)) labels = [];
      } catch {
        labels = [];
      }
      try {
        pointsOfInterest = sanitizePois(JSON.parse(f.pointsOfInterest || '[]'));
      } catch {
        pointsOfInterest = [];
      }
      try {
        integrations = sanitizeIntegrationRows(JSON.parse(f.integrations || '[]'));
      } catch {
        integrations = [];
      }
      try {
        captureDetails = sanitizeCaptureDetails(JSON.parse(f.captureDetails || '{}'));
      } catch {
        captureDetails = {};
      }
      const notes = typeof f.notes === 'string' ? f.notes.slice(0, 5000) : '';
      const observationDate =
        typeof f.observationDate === 'string' && f.observationDate.trim()
          ? f.observationDate.trim().slice(0, 50)
          : null;
      const gearSetupId =
        typeof f.gearSetupId === 'string' && f.gearSetupId.trim()
          ? f.gearSetupId.trim().slice(0, 64)
          : null;
      const displayName =
        typeof f.displayName === 'string' && f.displayName.trim()
          ? f.displayName.trim().slice(0, 255)
          : fileName;

      return {
        manualPlacement,
        dsoIds,
        labels,
        pointsOfInterest,
        integrations,
        notes,
        observationDate,
        captureDetails,
        gearSetupId,
        displayName,
      };
    },

    async updateMetadata(id, changes) {
      const b = (changes ?? {}) as Record<string, any>;
      const dsoIds = Array.isArray(b.dsoIds) ? b.dsoIds : [];
      const labels = Array.isArray(b.labels) ? b.labels : [];
      const pointsOfInterest = sanitizePois(b.pointsOfInterest);
      const integrations = sanitizeIntegrationRows(b.integrations);
      const captureDetails = sanitizeCaptureDetails(b.captureDetails);
      const notes = typeof b.notes === 'string' ? b.notes.slice(0, 5000) : '';
      const originalName: string | undefined =
        typeof b.originalName === 'string' && b.originalName.trim()
          ? b.originalName.trim().slice(0, 255)
          : undefined;
      const observationDate: string | null =
        typeof b.observationDate === 'string' && b.observationDate.trim()
          ? b.observationDate.trim().slice(0, 50)
          : null;
      const gearSetupId = cleanSetupId(b.gearSetupId);

      const values: SqlValue[] = [
        JSON.stringify(dsoIds),
        JSON.stringify(labels),
        JSON.stringify(pointsOfInterest),
        notes,
        JSON.stringify(integrations),
        observationDate,
        JSON.stringify(captureDetails),
        gearSetupId,
      ];
      const result =
        originalName !== undefined
          ? await db.run(UPDATE_METADATA_WITH_NAME, [...values, originalName, id])
          : await db.run(UPDATE_METADATA, [...values, id]);
      if (result.changes === 0) throw photoNotFound();
      return originalName !== undefined ? { originalName } : {};
    },

    async setManualPlacement(id, placement) {
      const json = placement ? JSON.stringify(placement) : null;
      if ((await db.run(UPDATE_PLACEMENT, [json, id])).changes === 0) throw photoNotFound();
    },

    async setOrder(photoIds) {
      if (
        !Array.isArray(photoIds) ||
        photoIds.some((id) => typeof id !== 'string' || id.length === 0)
      ) {
        throw invalidOrder('photoIds must be a non-empty array of strings');
      }
      if (new Set(photoIds).size !== photoIds.length) {
        throw invalidOrder('photoIds contains duplicates');
      }
      // The check and the writes are one transaction, so the list cannot go stale in between.
      await db.transaction(async (tx) => {
        const allIds = new Set((await tx.all<{ id: string }>(SELECT_IDS)).map((r) => r.id));
        if (photoIds.length !== allIds.size || photoIds.some((id) => !allIds.has(id))) {
          throw invalidOrder('photoIds must include all existing photos exactly once');
        }
        if (photoIds.length > 0) {
          await tx.batch(photoIds.map((id, i) => ({ sql: UPDATE_DRAW_ORDER, params: [i, id] })));
        }
      });
    },

    async removeRow(id) {
      return (await db.run(DELETE_PHOTO, [id])).changes > 0;
    },

    async removeRows(ids) {
      const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
      if (wanted.length === 0) return 0;
      return db.transaction(async (tx) => {
        const existing = new Set((await tx.all<{ id: string }>(SELECT_IDS)).map((r) => r.id));
        const doomed = wanted.filter((id) => existing.has(id));
        if (doomed.length > 0) {
          await tx.batch(doomed.map((id) => ({ sql: DELETE_PHOTO, params: [id] })));
        }
        return doomed.length;
      });
    },

    async removeAll() {
      const rows = await db.all<{ id: string; filename: string }>(SELECT_IDS_FILENAMES);
      for (const r of rows) {
        await blobs.remove(r.filename);
        await blobs.remove(thumbnailNameOf(r.filename));
      }
      return service.removeAllRows();
    },

    async removeAllRows() {
      return (await db.run(DELETE_ALL_PHOTOS)).changes;
    },

    async findByOriginalNames(names) {
      if (names.length === 0) return [];
      const idByName = new Map<string, string>();
      for (const r of await db.all<{ id: string; original_name: string }>(SELECT_NAMES)) {
        if (!idByName.has(r.original_name)) idByName.set(r.original_name, r.id);
      }
      const found: { originalName: string; id: string }[] = [];
      for (const name of names) {
        const id = idByName.get(name);
        if (id !== undefined) found.push({ originalName: name, id });
      }
      return found;
    },

    async importPhoto(photo, strategy) {
      const p = photo as unknown as Record<string, any>;
      const id: string = p.id;
      const correspondences: PhotoCorrespondenceInput[] = Array.isArray(p.correspondences)
        ? p.correspondences
        : [];
      return db.transaction(async (tx) => {
        if (strategy === 'replace') await tx.run(DELETE_PHOTO, [id]);
        const result = await tx.run(INSERT_PHOTO_WITH_ID, [
          id,
          p.filename ?? `${id}.jpg`,
          p.originalName ?? p.filename ?? id,
          p.width ?? 0,
          p.height ?? 0,
          p.createdAt ?? new Date().toISOString(),
          p.manualPlacement ? JSON.stringify(p.manualPlacement) : null,
          JSON.stringify(Array.isArray(p.dsoIds) ? p.dsoIds : []),
          JSON.stringify(Array.isArray(p.labels) ? p.labels : []),
          JSON.stringify(sanitizePois(p.pointsOfInterest)),
          typeof p.notes === 'string' ? p.notes : '',
          JSON.stringify(sanitizeIntegrationRows(p.integrations)),
          typeof p.thumbFilename === 'string' && p.thumbFilename ? p.thumbFilename : null,
          typeof p.observationDate === 'string' ? p.observationDate : null,
          JSON.stringify(sanitizeCaptureDetails(p.captureDetails)),
          cleanSetupId(p.gearSetupId),
        ]);
        if (result.changes === 0) return 'skipped' as const;
        if (correspondences.length > 0) {
          await tx.batch(correspondenceStatements(id, correspondences));
        }
        return 'imported' as const;
      });
    },
  };
  return service;
}
