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
