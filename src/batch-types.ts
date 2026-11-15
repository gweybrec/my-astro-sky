import type {
  PlateSolveResult,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
  CaptureDetails,
  ManualPlacement,
  Photo,
} from '@myastrosky/core/types';
import type { FitsCard } from '@myastrosky/core/fits-header';

export type SolverType = 'solve-field' | 'astap' | 'astrometry';

/**
 * Where a photo of "Ajouter des photos" stands for its placement:
 * `pending` À résoudre · `converting` a raw file being read · `waiting` queued for a local solver · `solving` ·
 * `success` placed · `failed` · `canceled` · `unfinished` astrometry.net had not finished ("En cours").
 */
export type BatchItemStatus =
  | 'pending'
  | 'converting'
  | 'waiting'
  | 'solving'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'unfinished';

/**
 * Where it stands for saving: `new` never saved · `saving` · `saved` the stored photo is as shown · `modified` saved,
 * then changed ("À réenregistrer").
 */
export type BatchSaveState = 'new' | 'saving' | 'saved' | 'modified';

/** How a placed photo was placed: the method row it shows ticked. */
export type BatchPlacedBy = 'local' | 'online' | 'file' | 'reuse' | 'stars' | 'hand';

/** The astrometry.net solve of a photo: kept with it, so that the result is fetched later without a new upload. */
export interface BatchOnlineSolve {
  submissionId?: number;
  jobId?: string;
  /** When the picture was sent (ISO date). */
  sentAt: string;
  checkedAt?: string;
  /** The picture sent was a FITS file (its rows count from the bottom). */
  fits: boolean;
}

export interface BatchItem {
  id: string;
  file: File;
  /** Original raw file kept for astrometry.net after `file` becomes its PNG preview. */
  rawFile?: File | null;
  /** Original raw filename (e.g. "M101.fit") while the item is converting/converted; null for a plain jpg/png/webp import. */
  rawName: string | null;
  /** Upload progress (0-1) of the raw file to the conversion endpoint, while status is 'converting'. */
  convertProgress: number;
  thumbBlobUrl: string | null;
  solver: SolverType;
  hintCoords: { ra: number; dec: number } | null;
  hintTargetName: string;
  fovDeg: number | null;
  wcsResult: PlateSolveResult | null;
  solveCorrespondences: PhotoCorrespondence[] | null;
  /** Set when the photo was dragged into place on the map (saved with the photo). */
  manualPlacement?: ManualPlacement | null;
  status: BatchItemStatus;
  saveState: BatchSaveState;
  /** How the placement was found (the ticked method), when placed. */
  placedBy?: BatchPlacedBy;
  /** The name of the solved file read for it ("Déjà résolue : …"). */
  wcsFileName?: string;
  /** The stored photo has the placement shown (false once it is placed or placed again after saving). */
  placementSaved: boolean;
  /** Its astrometry.net solve, while one runs or waits ("En cours"). */
  online: BatchOnlineSolve | null;
  /** Ticked in the list, for "Modifier N photos". */
  ticked: boolean;
  /** The stored photo, once saved. */
  photo: Photo | null;
  error: string;
  diagnostics?: string;
  dsoIds: string[];
  labels: string[];
  pointsOfInterest: PointOfInterest[];
  integrations: PhotoIntegration[];
  observationDate: string;
  captureDetails: CaptureDetails;
  gearSetupId: string | null;
  /** The header cards of the raw or solved file read for this photo, saved with it. */
  fitsHeaders?: FitsCard[] | null;
  /** Shown when the file read has no plate solution (its capture data was still taken). */
  wcsNotice?: string;
  notes: string;
  customName: string;
  elapsedSeconds: number;
  localJobId: string | null;
  solveTimer: ReturnType<typeof setInterval> | null;
  pollingTimer: ReturnType<typeof setInterval> | null;
  solveAbort: AbortController | null;
  /** Why the last save failed. */
  saveError?: string;
}
