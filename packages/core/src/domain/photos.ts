// Photo service inputs: what a caller hands to `PhotoService` (the Photo output shape is in `../types`).
import type {
  CaptureDetails,
  ManualPlacement,
  Photo,
  PhotoIntegration,
  PointOfInterest,
} from '../types';

/** How a backup import treats a photo whose id is already in the database. */
export type PhotoImportStrategy = 'skip' | 'replace';

/** One star correspondence as it is written to the database. */
export interface PhotoCorrespondenceInput {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number | null;
  starDec?: number | null;
}

/** A photo row to create, with the correspondences that go with it. */
export interface NewPhotoInput {
  /** The id of the new row (the caller makes it: the image file is named after it). */
  id: string;
  filename: string;
  originalName: string;
  width: number;
  height: number;
  correspondences: readonly PhotoCorrespondenceInput[];
  /** The placement as a JSON string, or null. */
  manualPlacement?: string | null;
  dsoIds?: readonly string[];
  labels?: readonly string[];
  notes?: string;
  integrations?: readonly PhotoIntegration[];
  thumbFilename?: string | null;
  observationDate?: string | null;
  pointsOfInterest?: readonly PointOfInterest[];
  captureDetails?: CaptureDetails | null;
  gearSetupId?: string | null;
}

/** The text fields of the multipart form of `POST /api/photos` (the image itself travels separately). */
export interface UploadFields {
  /** JSON array of correspondences. */
  correspondences?: string;
  manualPlacement?: string;
  dsoIds?: string;
  labels?: string;
  pointsOfInterest?: string;
  integrations?: string;
  notes?: string;
  observationDate?: string;
  captureDetails?: string;
  gearSetupId?: string;
  displayName?: string;
}

/** The metadata of an upload after parsing and sanitising. */
export interface UploadMetadata {
  /** The placement as a JSON string, or null when there is none or it is not JSON. */
  manualPlacement: string | null;
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  notes: string;
  observationDate: string | null;
  captureDetails: CaptureDetails;
  gearSetupId: string | null;
  /** The name the user gave, or the name of the file. */
  displayName: string;
}

/** What `PATCH /api/photos/:id/metadata` may change; every field is checked and cleaned when it is written. */
export interface PhotoMetadataChanges {
  dsoIds?: readonly string[];
  labels?: readonly string[];
  integrations?: readonly PhotoIntegration[];
  notes?: string;
  /** The display name; absent, blank or not a string leaves the stored name alone. */
  originalName?: string;
  observationDate?: string | null;
  pointsOfInterest?: readonly PointOfInterest[];
  captureDetails?: CaptureDetails | null;
  gearSetupId?: string | null;
}

/** A placement as the API takes it: `null` (or any falsy value) clears it. */
export type ManualPlacementInput = ManualPlacement | null;

/** A photo of a backup manifest, read back with every field unchecked except the id. */
export interface BackupPhoto {
  id: string;
  filename?: unknown;
  originalName?: unknown;
  width?: unknown;
  height?: unknown;
  createdAt?: unknown;
  correspondences?: unknown;
  manualPlacement?: unknown;
  dsoIds?: unknown;
  labels?: unknown;
  notes?: unknown;
  integrations?: unknown;
  thumbFilename?: unknown;
  observationDate?: unknown;
  pointsOfInterest?: unknown;
  captureDetails?: unknown;
  gearSetupId?: unknown;
}

/** The image of an upload: the name it had on the sender's side and its bytes. */
export interface PhotoUploadFile {
  name: string;
  bytes: Uint8Array;
}

/** A problem of an upload that did not stop it. The photo is stored; the caller reports it. */
export interface PhotoUploadWarning {
  code: 'THUMBNAIL_FAILED';
  error: unknown;
}

/** What `upload` returns: the stored photo, the size the picture had as read, and the warnings. */
export interface PhotoUploadResult {
  photo: Photo;
  /** Pixel size and EXIF orientation of the file as it was sent. */
  source: { width: number; height: number; orientation?: number };
  warnings: PhotoUploadWarning[];
}

/** A photo as the list route returns it: the size of its image file, or null when the file is missing. */
export type PhotoWithSize = Photo & { fileSize: number | null };
