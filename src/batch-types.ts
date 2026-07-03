import type {
  PlateSolveResult,
  PhotoCorrespondence,
  PhotoIntegration,
  PointOfInterest,
  Photo,
} from './types';

export type SolverType = 'solve-field' | 'astap' | 'astrometry';
export type BatchItemStatus =
  | 'pending'
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
