/**
 * Sharing a sky by file. The sender's side writes a package (`exportTo`): the chosen photos with their full-size
 * pictures and what places and describes them, and nothing else of the user's data. The visitor's side reads one
 * (`inspect`, `open`) and keeps it as a visit, in tables of its own (`shared_skies`, `shared_sky_photos`): no function
 * of the photo service, the backup or the plans can see a visit, and no route can change one of its photos.
 */
import type { CancelSignal } from '../backend';
import {
  decodeUtf8,
  isValidZipEntryPath,
  MAX_ARCHIVE_DATA_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_IMAGE_BYTES,
  MAX_ARCHIVE_IMAGE_PIXELS,
} from '../domain/backup';
import { DomainError } from '../domain/errors';
import { customGearName, type CustomGearType } from '../domain/gear';
import {
  cleanSkyName,
  fileExtensionOf,
  parseShareManifest,
  SHARE_FORMAT_VERSION,
  SHARE_KIND,
  SHARE_MANIFEST_NAME,
  sharedSkyStatus,
  type SharedGear,
  type SharedPhoto,
  type SharedPoiCategory,
  type SharedSky,
  type SharedSkyPhoto,
  type SharedSkyPreview,
  type ShareManifest,
  type ShareRequest,
} from '../domain/shared-sky';
import { isSafeBlobName, type BlobStore } from '../ports/blob-store';
import type { BundleReader, BundleWriter } from '../ports/bundle';
import type { ImageCodec } from '../ports/image-codec';
import type { SqlDb, SqlStatement, SqlValue } from '../ports/sql-db';
import { stripGps } from '../strip-gps';
import type { Photo } from '../types';
import type { GearService } from './gear';
import {
  makeMissingMediumsIn,
  rowToPhoto,
  THUMB_QUALITY,
  THUMB_SIZE,
  thumbnailNameOf,
  type PhotoRow,
  type PhotoService,
} from './photos';
import type { PoiCategoryService } from './poi-categories';
import type { SettingsService } from './settings';

export interface SharedSkyServiceDeps {
  db: SqlDb;
  blobs: BlobStore;
  images: ImageCodec;
  photos: Pick<PhotoService, 'list'>;
  gear: Pick<GearService, 'listSetups' | 'listCatalog'>;
  poiCategories: Pick<PoiCategoryService, 'list'>;
  settings: Pick<SettingsService, 'get' | 'set'>;
  newId: () => string;
  /** The clock, in milliseconds since the epoch. */
  now: () => number;
  /** The room left where the pictures are stored, in bytes; null or absent when it cannot be known. */
  freeBytes?: () => Promise<number | null>;
}

export interface OpenSharedSkyOptions {
  /** Called after each photo: how many are done, out of how many. */
  onProgress?: (done: number, total: number) => void;
  cancel?: CancelSignal;
}

export interface SharedSkyService {
  /** The display name the user last shared under ('' before the first share). */
  senderName(): Promise<string>;
  /**
   * Checks a share before it is written: throws as `exportTo` for a blank name or when no chosen photo has its
   * picture. Reads no picture.
   */
  checkShare(request: ShareRequest): Promise<void>;
  /**
   * Writes a package: each picture with its position tags removed, then `share.json`. The display name is remembered.
   * Throws `invalid` with `SHARED_SKY_NAME_REQUIRED` for a blank name and `SHARED_SKY_NOTHING_TO_SHARE` when no
   * chosen photo has its picture.
   */
  exportTo(writer: BundleWriter, request: ShareRequest): Promise<void>;
  /**
   * What a package holds and how it stands against the visit kept of the same sky; writes nothing. Throws `invalid`
   * with `NOT_A_SHARED_SKY`, `SHARED_SKY_UNSUPPORTED`, `INVALID_ENTRY_PATH` or `BACKUP_TOO_LARGE`.
   */
  inspect(reader: BundleReader): Promise<SharedSkyPreview>;
  /**
   * Keeps a package as a visit, replacing the visit kept of the same sky. The pictures are
   * written first, under new names; the rows are then swapped in one atomic write and the old pictures removed. When
   * it fails or is cancelled, what it wrote is removed and the earlier visit is as it was. Throws as `inspect`, and
   * `invalid` with `NOT_ENOUGH_SPACE` when the room left is known and too small.
   */
  open(reader: BundleReader, options?: OpenSharedSkyOptions): Promise<SharedSky>;
  /** The visits kept, the most recently received first. */
  list(): Promise<SharedSky[]>;
  /** The photos of a visit, in the sender's order. Throws `notFound` (`SHARED_SKY_NOT_FOUND`). */
  listPhotos(skyId: string): Promise<SharedSkyPhoto[]>;
  /** Deletes a visit, rows and files. Returns the bytes freed. Throws `notFound` (`SHARED_SKY_NOT_FOUND`). */
  remove(skyId: string): Promise<{ bytesFreed: number }>;
  /** Makes the medium-sized copy of each large visit picture that has none. Returns the number made. */
  makeMissingMediums(): Promise<number>;
}

/** The setting that holds this device's sky id, made at the first share. */
const SKY_ID_SETTING = 'SHARE_SKY_ID';
/** The setting that holds the display name last shared under. */
const SENDER_NAME_SETTING = 'SHARE_SENDER_NAME';
/** Thumbnails weigh little against the pictures: the room asked for is the pictures' size plus this share. */
const THUMBNAIL_ROOM = 0.05;

interface SkyRow {
  id: string;
  sender_name: string;
  shared_at: string;
  received_at: string;
  photo_count: number;
  bytes: number;
  poi_categories: string;
}

interface VisitPhotoRow extends PhotoRow {
  shared_sky_id: string;
  correspondences: string;
  gear: string | null;
  author: string;
}

interface VisitFilesRow {
  filename: string;
  thumb_filename: string | null;
  medium_filename: string | null;
}

const INSERT_SKY = `INSERT INTO shared_skies (id, sender_name, display_name, shared_at, received_at, photo_count, bytes, poi_categories)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_VISIT_PHOTO = `INSERT INTO shared_sky_photos (id, shared_sky_id, source_id, position, filename, original_name, width, height, created_at, manual_placement, dso_ids, labels, notes, integrations, thumb_filename, observation_date, points_of_interest, capture_details, quarter_turns, correspondences, gear, author)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT_SKIES = 'SELECT * FROM shared_skies ORDER BY received_at DESC, id ASC';
const SELECT_SKY = 'SELECT * FROM shared_skies WHERE id = ?';
const SELECT_VISIT_PHOTOS =
  'SELECT * FROM shared_sky_photos WHERE shared_sky_id = ? ORDER BY position ASC, id ASC';
const SELECT_VISIT_FILES =
  'SELECT filename, thumb_filename, medium_filename FROM shared_sky_photos WHERE shared_sky_id = ?';
const DELETE_VISIT_PHOTOS = 'DELETE FROM shared_sky_photos WHERE shared_sky_id = ?';
const DELETE_SKY = 'DELETE FROM shared_skies WHERE id = ?';

const skyNotFound = (): DomainError =>
  new DomainError('notFound', 'Visited sky not found', { code: 'SHARED_SKY_NOT_FOUND' });

const nameRequired = (): DomainError =>
  new DomainError('invalid', 'A display name is required', { code: 'SHARED_SKY_NAME_REQUIRED' });

/** Core has no `DOMException`: this carries the name the callers test. */
const aborted = (): Error => Object.assign(new Error('Aborted'), { name: 'AbortError' });

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToSky(r: SkyRow): SharedSky {
  return {
    id: r.id,
    senderName: r.sender_name,
    sharedAt: r.shared_at,
    receivedAt: r.received_at,
    photoCount: r.photo_count,
    bytes: r.bytes,
    poiCategories: parseJson<SharedPoiCategory[]>(r.poi_categories, []),
  };
}

/** The files of a visit photo: its picture, its thumbnail and its medium-sized copy. */
const filesOf = (r: VisitFilesRow): string[] =>
  [r.filename, r.thumb_filename, r.medium_filename].filter(
    (name): name is string => !!name && isSafeBlobName(name),
  );

export function createSharedSkyService(deps: SharedSkyServiceDeps): SharedSkyService {
  const { db, blobs, images, photos, gear, poiCategories, settings, newId, now } = deps;

  /** The gear of each setup, by setup id, as text. */
  async function gearBySetup(): Promise<Map<string, SharedGear>> {
    const names = new Map<string, string>();
    for (const type of ['telescope', 'camera', 'accessory'] as const satisfies CustomGearType[]) {
      for (const item of (await gear.listCatalog(type)) as Record<string, unknown>[]) {
        if (typeof item.id === 'string') names.set(item.id, customGearName(type, item, item.id));
      }
    }
    const bySetup = new Map<string, SharedGear>();
    for (const setup of await gear.listSetups()) {
      const telescope = names.get(setup.telescopeId);
      const camera = names.get(setup.cameraId);
      const accessory = setup.accessoryId ? names.get(setup.accessoryId) : undefined;
      bySetup.set(setup.id, {
        ...(setup.name ? { setup: setup.name } : {}),
        ...(telescope ? { telescope } : {}),
        ...(camera ? { camera } : {}),
        ...(accessory ? { accessory } : {}),
      });
    }
    return bySetup;
  }

  /** This device's sky id, made and stored the first time. */
  async function ownSkyId(): Promise<string> {
    const stored = await settings.get(SKY_ID_SETTING);
    if (stored) return stored;
    const id = newId();
    await settings.set(SKY_ID_SETTING, id);
    return id;
  }

  /**
   * The names of a package's files and its manifest, after the checks that need nothing unpacked: no path that leaves
   * its folder, no name twice, not too many files, none larger than a real one once unpacked.
   */
  async function readPackage(
    reader: BundleReader,
  ): Promise<{ manifest: ShareManifest; photos: SharedPhoto[] }> {
    const names = await reader.names();
    for (const name of names) {
      if (!isValidZipEntryPath(name)) {
        throw new DomainError('invalid', `Invalid path in the archive: ${name}`, {
          code: 'INVALID_ENTRY_PATH',
        });
      }
    }
    if (new Set(names).size !== names.length) {
      throw new DomainError('invalid', 'A file comes twice in the archive', {
        code: 'INVALID_ENTRY_PATH',
      });
    }
    const tooLarge = () =>
      new DomainError('invalid', 'Shared sky too large', { code: 'BACKUP_TOO_LARGE' });
    if (names.length > MAX_ARCHIVE_ENTRIES) throw tooLarge();
    if (!names.includes(SHARE_MANIFEST_NAME)) {
      throw new DomainError('invalid', 'This file is not a shared sky', {
        code: 'NOT_A_SHARED_SKY',
      });
    }
    if (((await reader.size(SHARE_MANIFEST_NAME)) ?? 0) > MAX_ARCHIVE_DATA_BYTES) throw tooLarge();

    let raw: unknown;
    try {
      raw = JSON.parse(decodeUtf8((await reader.read(SHARE_MANIFEST_NAME)) ?? new Uint8Array()));
    } catch {
      throw new DomainError('invalid', 'This file is not a shared sky', {
        code: 'NOT_A_SHARED_SKY',
      });
    }
    const manifest = parseShareManifest(raw);
    // Only the photos whose picture is in the package, at the size the package itself declares.
    const present: SharedPhoto[] = [];
    for (const photo of manifest.photos) {
      const size = await reader.size(`images/${photo.file}`);
      if (size === null) continue;
      if (size > MAX_ARCHIVE_IMAGE_BYTES) throw tooLarge();
      present.push({ ...photo, bytes: size });
    }
    return { manifest, photos: present };
  }

  const freeBytes = async (): Promise<number | null> =>
    deps.freeBytes ? deps.freeBytes().catch(() => null) : null;

  async function previewOf(manifest: ShareManifest, present: SharedPhoto[]) {
    const kept = await db.get<SkyRow>(SELECT_SKY, [manifest.skyId]);
    const preview: SharedSkyPreview = {
      skyId: manifest.skyId,
      senderName: manifest.senderName,
      sharedAt: manifest.sharedAt,
      photoCount: present.length,
      bytes: present.reduce((sum, p) => sum + p.bytes, 0),
      status: sharedSkyStatus(manifest.sharedAt, kept?.shared_at),
      ...(kept
        ? {
            existing: {
              senderName: kept.sender_name,
              sharedAt: kept.shared_at,
              photoCount: kept.photo_count,
            },
          }
        : {}),
      freeBytes: await freeBytes(),
    };
    return { preview, kept };
  }

  /** Whether the bytes are a picture the apps can decode. */
  async function isStorablePicture(bytes: Uint8Array): Promise<boolean> {
    try {
      const { width, height } = await images.probe(bytes);
      return width > 0 && height > 0 && width * height <= MAX_ARCHIVE_IMAGE_PIXELS;
    } catch {
      return false;
    }
  }

  async function removeBlobs(names: readonly string[]): Promise<number> {
    let freed = 0;
    for (const name of names) {
      freed += (await blobs.size(name).catch(() => null)) ?? 0;
      await blobs
        .remove(name)
        .catch((err) => console.warn(`[SharedSky] Could not remove ${name}:`, err));
    }
    return freed;
  }

  /** The photos a share takes: those whose id is in `ids`, or all of them when `ids` is absent or empty. */
  async function selectPhotos(ids: readonly string[] | undefined): Promise<Photo[]> {
    const all = await photos.list();
    return Array.isArray(ids) && ids.length > 0 ? all.filter((p) => ids.includes(p.id)) : all;
  }

  const nothingToShare = (): DomainError =>
    new DomainError('invalid', 'No photo to share', { code: 'SHARED_SKY_NOTHING_TO_SHARE' });

  const service: SharedSkyService = {
    async senderName() {
      return (await settings.get(SENDER_NAME_SETTING)) ?? '';
    },

    async checkShare(request) {
      if (!cleanSkyName(request.senderName)) throw nameRequired();
      for (const photo of await selectPhotos(request.ids)) {
        if (isSafeBlobName(photo.filename) && (await blobs.size(photo.filename)) !== null) return;
      }
      throw nothingToShare();
    },

    async exportTo(writer, request) {
      const senderName = cleanSkyName(request.senderName);
      if (!senderName) throw nameRequired();
      const selected = await selectPhotos(request.ids);
      const gearOf = request.includeGear ? await gearBySetup() : new Map<string, SharedGear>();

      const shared: SharedPhoto[] = [];
      const usedCategories = new Set<string>();
      for (const photo of selected) {
        // A name outside the photo folder (from a backup imported before names were checked) is not read.
        if (!isSafeBlobName(photo.filename)) continue;
        const stored = await blobs.get(photo.filename);
        if (!stored) continue;
        const picture = stripGps(stored);
        await writer.add(`images/${photo.filename}`, picture);
        for (const poi of photo.pointsOfInterest) usedCategories.add(poi.categoryId);
        const photoGear = photo.gearSetupId ? gearOf.get(photo.gearSetupId) : undefined;
        const details = photo.captureDetails ?? {};
        shared.push({
          id: photo.id,
          file: photo.filename,
          bytes: picture.length,
          originalName: photo.originalName,
          width: photo.width,
          height: photo.height,
          quarterTurns: photo.quarterTurns ?? 0,
          correspondences: photo.correspondences,
          ...(photo.manualPlacement ? { manualPlacement: photo.manualPlacement } : {}),
          dsoIds: photo.dsoIds,
          labels: photo.labels,
          notes: photo.notes,
          pointsOfInterest: photo.pointsOfInterest,
          observationDate: photo.observationDate ?? null,
          integrations: photo.integrations ?? [],
          author: senderName,
          ...(request.includeGear && Object.keys(details).length > 0
            ? { captureDetails: details }
            : {}),
          ...(photoGear && Object.keys(photoGear).length > 0 ? { gear: photoGear } : {}),
        });
      }
      if (shared.length === 0) throw nothingToShare();

      const manifest: ShareManifest = {
        kind: SHARE_KIND,
        formatVersion: SHARE_FORMAT_VERSION,
        skyId: await ownSkyId(),
        senderName,
        sharedAt: new Date(now()).toISOString(),
        photos: shared,
        poiCategories: (await poiCategories.list())
          .filter((c) => usedCategories.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, color: c.color })),
      };
      // Last: it holds the size of each picture as written. A reader finds it by name, wherever it is.
      await writer.add(SHARE_MANIFEST_NAME, encode(manifest));
      await settings.set(SENDER_NAME_SETTING, senderName);
    },

    async inspect(reader) {
      const { manifest, photos: present } = await readPackage(reader);
      return (await previewOf(manifest, present)).preview;
    },

    async open(reader, options = {}) {
      const { manifest, photos: present } = await readPackage(reader);
      const { preview, kept } = await previewOf(manifest, present);
      const needed = preview.bytes * (1 + THUMBNAIL_ROOM);
      if (preview.freeBytes !== null && preview.freeBytes < needed) {
        throw new DomainError('invalid', 'Not enough free space', { code: 'NOT_ENOUGH_SPACE' });
      }

      const receivedAt = new Date(now()).toISOString();
      const written: string[] = [];
      const rows: SqlStatement[] = [];
      let bytes = 0;
      try {
        for (const [index, photo] of present.entries()) {
          if (options.cancel?.aborted) throw aborted();
          const picture = await reader.read(`images/${photo.file}`);
          if (picture && (await isStorablePicture(picture))) {
            // New names: a visit never takes the file of one of the user's photos, nor of another visit.
            const id = newId();
            const filename = `${id}${fileExtensionOf(photo.file)}`;
            await blobs.put(filename, picture);
            written.push(filename);
            bytes += picture.length;
            let thumbFilename: string | null = thumbnailNameOf(filename);
            try {
              const thumb = await images.thumbnail(picture, THUMB_SIZE, THUMB_QUALITY);
              await blobs.put(thumbFilename, thumb);
              written.push(thumbFilename);
              bytes += thumb.length;
            } catch (err) {
              console.warn(`[SharedSky] No thumbnail for ${photo.originalName}:`, err);
              thumbFilename = null;
            }
            rows.push({
              sql: INSERT_VISIT_PHOTO,
              params: [
                id,
                manifest.skyId,
                photo.id,
                index,
                filename,
                photo.originalName,
                photo.width,
                photo.height,
                receivedAt,
                photo.manualPlacement ? JSON.stringify(photo.manualPlacement) : null,
                JSON.stringify(photo.dsoIds),
                JSON.stringify(photo.labels),
                photo.notes,
                JSON.stringify(photo.integrations),
                thumbFilename,
                photo.observationDate,
                JSON.stringify(photo.pointsOfInterest),
                JSON.stringify(photo.captureDetails ?? {}),
                photo.quarterTurns,
                JSON.stringify(photo.correspondences),
                photo.gear ? JSON.stringify(photo.gear) : null,
                photo.author,
              ] as SqlValue[],
            });
          } else {
            console.warn(`[SharedSky] ${photo.file} is not a picture the apps can open: left out`);
          }
          options.onProgress?.(index + 1, present.length);
        }
        if (options.cancel?.aborted) throw aborted();

        const oldFiles = kept
          ? (await db.all<VisitFilesRow>(SELECT_VISIT_FILES, [manifest.skyId])).flatMap(filesOf)
          : [];
        const senderName = manifest.senderName || kept?.sender_name || '';
        await db.batch([
          { sql: DELETE_VISIT_PHOTOS, params: [manifest.skyId] },
          { sql: DELETE_SKY, params: [manifest.skyId] },
          {
            sql: INSERT_SKY,
            params: [
              manifest.skyId,
              senderName,
              // `display_name` is no longer read: a visit shows its sender's name.
              senderName,
              manifest.sharedAt,
              receivedAt,
              rows.length,
              bytes,
              JSON.stringify(manifest.poiCategories),
            ],
          },
          ...rows,
        ]);
        await removeBlobs(oldFiles);
      } catch (err) {
        await removeBlobs(written);
        throw err;
      }
      return rowToSky((await db.get<SkyRow>(SELECT_SKY, [manifest.skyId]))!);
    },

    async list() {
      return (await db.all<SkyRow>(SELECT_SKIES)).map(rowToSky);
    },

    async listPhotos(skyId) {
      const sky = await db.get<SkyRow>(SELECT_SKY, [skyId]);
      if (!sky) throw skyNotFound();
      const rows = await db.all<VisitPhotoRow>(SELECT_VISIT_PHOTOS, [skyId]);
      const sizes = await Promise.all(rows.map((r) => blobs.size(r.filename).catch(() => null)));
      return rows.map((row, i) => {
        const sharedGear = parseJson<SharedGear | null>(row.gear, null);
        return {
          ...rowToPhoto(row, []),
          correspondences: parseJson<Photo['correspondences']>(row.correspondences, []),
          sharedSkyId: row.shared_sky_id,
          // A photo kept before authors were stored is its sender's.
          author: row.author || sky.sender_name,
          ...(sharedGear ? { sharedGear } : {}),
          fileSize: sizes[i],
        };
      });
    },

    async remove(skyId) {
      if (!(await db.get<SkyRow>(SELECT_SKY, [skyId]))) throw skyNotFound();
      const files = (await db.all<VisitFilesRow>(SELECT_VISIT_FILES, [skyId])).flatMap(filesOf);
      // The rows first: a visit whose rows are gone shows nowhere, even if a file could not be removed.
      await db.batch([
        { sql: DELETE_VISIT_PHOTOS, params: [skyId] },
        { sql: DELETE_SKY, params: [skyId] },
      ]);
      return { bytesFreed: await removeBlobs(files) };
    },

    makeMissingMediums: () => makeMissingMediumsIn('shared_sky_photos', { db, blobs, images }),
  };
  return service;
}
