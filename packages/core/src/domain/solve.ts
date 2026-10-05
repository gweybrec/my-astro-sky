// Plate-solving / raw-conversion API shapes.

import type { PlateSolveResult } from '../types';

/**
 * Result of converting a raw astro image to PNG. `TFile` is the platform file type
 * (`File` in the browser — see `src/api.ts`); core has no DOM typings, so it is a parameter.
 */
export interface ConvertRawPhotoResult<TFile = unknown> {
  png: TFile;
  meta: PlateSolveResult & { width: number; height: number };
}

export interface AstrometrySubmission {
  submissionId: number;
  jobId?: number;
  status: string;
  timestamp?: string;
  filename?: string;
  width?: number;
  height?: number;
}

/** A plate-solve search hint sent to astrometry.net. A NaN value is sent as the host gave it. */
export interface NovaSolveHints {
  /** Centre of the search, degrees. Used only together with `dec`. */
  ra?: number;
  dec?: number;
  /** Search radius in degrees (2 when absent). */
  radius?: number;
  /** Arcseconds per pixel; when neither bound is given the scale is estimated from the picture. */
  scale_lower?: number;
  scale_upper?: number;
}

/** A picture handed to online solving. */
export interface NovaSolveFile {
  fileName: string;
  bytes: Uint8Array;
}

/** One star correspondence of a solved job. */
export interface NovaCorrespondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
  starRa?: number;
  starDec?: number;
}

/** Where a submitted job is: `pending` and `solving` run, the others are final. */
export type NovaJobState = 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';

/** What `GET /api/solve-plate/:id` returns. */
export interface NovaJobStatus {
  jobId: string;
  status: NovaJobState;
  correspondences?: NovaCorrespondence[];
  error?: string;
  /** Normalised ids of the known objects in the field, e.g. `["NGC5457", "M101"]`. */
  dsoIds?: string[];
}

/** Outcome of reusing an existing astrometry.net job for a new picture. */
export interface NovaReuseResult {
  success: boolean;
  correspondences?: NovaCorrespondence[];
  dsoIds?: string[];
  error?: string;
}
