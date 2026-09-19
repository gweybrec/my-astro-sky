import type {
  PlateSolveResult,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
  CaptureDetails,
  Photo,
} from './types';

export type SolverType = 'solve-field' | 'astap' | 'astrometry';
export type BatchItemStatus =
  | 'pending'
  | 'converting'
  | 'wcs-ready'
  | 'solving'
  | 'success'
  | 'failed'
  | 'waiting'
  | 'canceled'
  | 'placing'
  | 'placed';

export interface BatchItem {
  id: string;
  file: File;
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
  status: BatchItemStatus;
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
  notes: string;
  customName: string;
  elapsedSeconds: number;
  localJobId: string | null;
  solveTimer: ReturnType<typeof setInterval> | null;
  pollingTimer: ReturnType<typeof setInterval> | null;
  solveAbort: AbortController | null;
  metaOpen: boolean;
  uploadError?: string;
}
