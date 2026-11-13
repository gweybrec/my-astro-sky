/**
 * A shared sky: the package one person writes (`share.json` and the full-size pictures in a ZIP named
 * `<name>.myastrosky`) and the visit another person keeps of it. This file holds the shapes and the pure rules; the
 * reading and writing are in `services/shared-skies.ts`.
 */
import {
  ALLOWED_PHOTO_EXTENSIONS,
  sanitizeIntegrationRows,
  sanitizePois,
} from '../services/photos';
import { isSafeBlobName } from '../ports/blob-store';
import type {
  CaptureDetails,
  ManualPlacement,
  Photo,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
  QuarterTurns,
} from '../types';
import { sanitizeCaptureDetails } from '../wcs';
import { MAX_ARCHIVE_ENTRIES } from './backup';
import { DomainError } from './errors';

/** The manifest's file in the package. */
export const SHARE_MANIFEST_NAME = 'share.json';
/** What tells a shared sky from a backup, whatever the file is called. */
export const SHARE_KIND = 'shared-sky';
/** The manifest format this version writes, and the latest it reads. */
export const SHARE_FORMAT_VERSION = 2;
/** The extension of a package file, with its dot. */
export const SHARE_FILE_EXTENSION = '.myastrosky';
/** The longest display name of a sender or of a visit. */
export const MAX_SKY_NAME_LENGTH = 60;
const MAX_CORRESPONDENCES = 100;
const MAX_LIST_ITEMS = 200;

/** The gear a photo was taken with, written out: an id of the sender's gear lists means nothing elsewhere. */
export interface SharedGear {
  setup?: string;
  telescope?: string;
  camera?: string;
  accessory?: string;
}

/** A category of points of interest the shared photos use, as the sender has it. */
export interface SharedPoiCategory {
  id: string;
  name: string;
  color: string;
}

/** One photo of a package. */
export interface SharedPhoto {
  /** The photo's id on the sender's device. */
  id: string;
  /** The picture's file name inside `images/`. */
  file: string;
  /** The picture's size in bytes. */
  bytes: number;
  originalName: string;
  width: number;
  height: number;
  quarterTurns: QuarterTurns;
  correspondences: PhotoCorrespondence[];
  manualPlacement?: ManualPlacement;
  dsoIds: string[];
  labels: string[];
  notes: string;
  pointsOfInterest: PointOfInterest[];
  observationDate: string | null;
  integrations: PhotoIntegration[];
  /** Who took the photo: the name the sender shared it under. Never changed on the visitor's device. */
  author: string;
  /** Present only when the sender shares gear and capture details. */
  captureDetails?: CaptureDetails;
  gear?: SharedGear;
}

export interface ShareManifest {
  kind: typeof SHARE_KIND;
  formatVersion: number;
  /** Made once on the sender's device and written in every package: how a visitor's app knows the same sky. */
  skyId: string;
  senderName: string;
  /** When this package was written (ISO): a later one replaces an earlier one. */
  sharedAt: string;
  photos: SharedPhoto[];
  poiCategories: SharedPoiCategory[];
}

/** What "Share my sky" asks for. */
export interface ShareRequest {
  /** The photos to share; all of them when absent or empty. */
  ids?: string[];
  senderName: string;
  /** Whether gear and capture details travel with the photos. */
  includeGear: boolean;
}

/** A visited sky, as kept. */
export interface SharedSky {
  id: string;
  /** The name the sender typed; shown as it is, never changed on this device. */
  senderName: string;
  sharedAt: string;
  receivedAt: string;
  photoCount: number;
  /** The size on disk of its pictures and thumbnails, in bytes. */
  bytes: number;
  poiCategories: SharedPoiCategory[];
}

/** How a package stands against the visit already kept of the same sky. */
export type SharedSkyStatus = 'new' | 'update' | 'same' | 'older';

/** What a package holds, read before anything is written. */
export interface SharedSkyPreview {
  skyId: string;
  senderName: string;
  sharedAt: string;
  photoCount: number;
  /** The size of its pictures, in bytes. */
  bytes: number;
  status: SharedSkyStatus;
  /** The visit already kept of this sky, when there is one. */
  existing?: { senderName: string; sharedAt: string; photoCount: number };
  /** The room left where the pictures go, in bytes; null when it cannot be known. */
  freeBytes: number | null;
}

/** A photo of a visit: a `Photo` the screens show like any other, marked as not the user's own. */
export type SharedSkyPhoto = Photo & {
  sharedSkyId: string;
  author: string;
  fileSize: number | null;
};

const notASharedSky = (): DomainError =>
  new DomainError('invalid', 'This file is not a shared sky', { code: 'NOT_A_SHARED_SKY' });

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const textList = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string')
        .slice(0, MAX_LIST_ITEMS)
        .map((s) => s.slice(0, max))
    : [];

const isPixelCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The id of a sky: letters, digits and dashes, as `newId` makes them. */
export function isValidSkyId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/** The display name as it is stored: trimmed, without control characters, of a bounded length. */
export function cleanSkyName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return [...name]
    .filter((c) => c.charCodeAt(0) >= 0x20)
    .join('')
    .trim()
    .slice(0, MAX_SKY_NAME_LENGTH);
}

/** The file name of a package of `senderName`: `Paul.myastrosky`; characters a file name cannot hold become `-`. */
export function shareFileName(senderName: string): string {
  const base = cleanSkyName(senderName)
    .replace(/[<>:"/\\|?*.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  return `${base || 'sky'}${SHARE_FILE_EXTENSION}`;
}

/** The file extension of a name, lower-cased, with its dot ('' when there is none). */
export function fileExtensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function parseCorrespondences(raw: unknown): PhotoCorrespondence[] {
  if (!Array.isArray(raw)) return [];
  const out: PhotoCorrespondence[] = [];
  for (const c of raw.slice(0, MAX_CORRESPONDENCES)) {
    if (
      !Number.isInteger(c?.pointIndex) ||
      !isFiniteNumber(c.photoX) ||
      !isFiniteNumber(c.photoY) ||
      !Number.isInteger(c.starHip)
    ) {
      continue;
    }
    out.push({
      pointIndex: c.pointIndex,
      photoX: c.photoX,
      photoY: c.photoY,
      starHip: c.starHip,
      starName: text(c.starName, 100),
      ...(isFiniteNumber(c.starRa) ? { starRa: c.starRa } : {}),
      ...(isFiniteNumber(c.starDec) ? { starDec: c.starDec } : {}),
    });
  }
  return out;
}

function parseManualPlacement(raw: unknown): ManualPlacement | undefined {
  const p = raw as Partial<ManualPlacement> | null;
  if (
    !p ||
    typeof p !== 'object' ||
    !isFiniteNumber(p.centerRa) ||
    !isFiniteNumber(p.centerDec) ||
    !isFiniteNumber(p.rotationDeg) ||
    !isFiniteNumber(p.projPerPx)
  ) {
    return undefined;
  }
  return {
    centerRa: p.centerRa,
    centerDec: p.centerDec,
    rotationDeg: p.rotationDeg,
    projPerPx: p.projPerPx,
    mirrorX: p.mirrorX === true,
    mirrorY: p.mirrorY === true,
    ...(p.angleOnSky === true ? { angleOnSky: true } : {}),
  };
}

function parseGear(raw: unknown): SharedGear | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  const gear: SharedGear = {};
  for (const key of ['setup', 'telescope', 'camera', 'accessory'] as const) {
    const value = text(g[key], 120);
    if (value) gear[key] = value;
  }
  return Object.keys(gear).length > 0 ? gear : undefined;
}

/** A photo of a manifest, cleaned; null when it has no id, no usable picture name or no size. */
function parsePhoto(raw: unknown): SharedPhoto | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  const id = text(p.id, 64);
  const file = p.file;
  if (!id || !isSafeBlobName(file) || !ALLOWED_PHOTO_EXTENSIONS.has(fileExtensionOf(file))) {
    return null;
  }
  if (!isPixelCount(p.width) || !isPixelCount(p.height)) return null;
  const gear = parseGear(p.gear);
  const placement = parseManualPlacement(p.manualPlacement);
  return {
    id,
    file,
    bytes: isFiniteNumber(p.bytes) && p.bytes >= 0 ? p.bytes : 0,
    originalName: text(p.originalName, 255) || file,
    width: p.width,
    height: p.height,
    quarterTurns:
      p.quarterTurns === 1 || p.quarterTurns === 2 || p.quarterTurns === 3 ? p.quarterTurns : 0,
    correspondences: parseCorrespondences(p.correspondences),
    ...(placement ? { manualPlacement: placement } : {}),
    dsoIds: textList(p.dsoIds, 100),
    labels: textList(p.labels, 100),
    notes: typeof p.notes === 'string' ? p.notes.slice(0, 20_000) : '',
    pointsOfInterest: sanitizePois(p.pointsOfInterest).slice(0, MAX_LIST_ITEMS),
    observationDate: text(p.observationDate, 40) || null,
    integrations: sanitizeIntegrationRows(p.integrations).slice(0, MAX_LIST_ITEMS),
    author: cleanSkyName(p.author),
    ...(p.captureDetails && typeof p.captureDetails === 'object'
      ? { captureDetails: sanitizeCaptureDetails(p.captureDetails) }
      : {}),
    ...(gear ? { gear } : {}),
  };
}

function parsePoiCategories(raw: unknown): SharedPoiCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedPoiCategory[] = [];
  for (const c of raw.slice(0, MAX_LIST_ITEMS)) {
    const id = text(c?.id, 64);
    const name = text(c?.name, 100);
    if (!id || !name) continue;
    const color = text(c.color, 32);
    out.push({ id, name, color: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#888888' });
  }
  return out;
}

/**
 * The manifest of a package, checked and cleaned: everything in it comes from someone else's file. Throws `invalid`
 * with `NOT_A_SHARED_SKY` when it is not one (a backup, any other JSON) and `SHARED_SKY_UNSUPPORTED` when it was
 * written by a later version of the app. A photo that cannot be used is left out; two photos naming one picture file
 * keep the first.
 */
// `unknown`: the content of a file, checked here at run time.
export function parseShareManifest(raw: unknown): ShareManifest {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.kind !== SHARE_KIND) {
    throw notASharedSky();
  }
  if (!Number.isInteger(m.formatVersion) || (m.formatVersion as number) < 1) throw notASharedSky();
  if ((m.formatVersion as number) > SHARE_FORMAT_VERSION) {
    throw new DomainError('invalid', 'This shared sky was written by a later version', {
      code: 'SHARED_SKY_UNSUPPORTED',
    });
  }
  const sharedAt = typeof m.sharedAt === 'string' ? m.sharedAt : '';
  if (!isValidSkyId(m.skyId) || !Array.isArray(m.photos) || Number.isNaN(Date.parse(sharedAt))) {
    throw notASharedSky();
  }
  const files = new Set<string>();
  const photos: SharedPhoto[] = [];
  for (const rawPhoto of m.photos.slice(0, MAX_ARCHIVE_ENTRIES)) {
    const photo = parsePhoto(rawPhoto);
    // File names are compared without their case: they are one file on Windows.
    if (!photo || files.has(photo.file.toLowerCase())) continue;
    files.add(photo.file.toLowerCase());
    photos.push(photo);
  }
  const senderName = cleanSkyName(m.senderName);
  return {
    kind: SHARE_KIND,
    formatVersion: m.formatVersion as number,
    skyId: m.skyId,
    senderName,
    sharedAt: new Date(Date.parse(sharedAt)).toISOString(),
    // A photo written without its author (an earlier package) is the sender's.
    photos: photos.map((photo) => (photo.author ? photo : { ...photo, author: senderName })),
    poiCategories: parsePoiCategories(m.poiCategories),
  };
}

/** How a package dated `sharedAt` stands against the visit kept of the same sky (`keptSharedAt`; absent: none). */
export function sharedSkyStatus(sharedAt: string, keptSharedAt?: string): SharedSkyStatus {
  if (keptSharedAt === undefined) return 'new';
  const incoming = Date.parse(sharedAt);
  const kept = Date.parse(keptSharedAt);
  if (incoming === kept) return 'same';
  return incoming > kept ? 'update' : 'older';
}
