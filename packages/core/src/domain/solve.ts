// Plate-solving / raw-conversion API shapes.

import type { FileSource, TransferOptions } from '../backend';
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

/** One page of the account's submissions, most recent first, and how many the account has in all. */
export interface AstrometrySubmissionPage {
  submissions: AstrometrySubmission[];
  total: number;
}

/** A plate-solve search hint sent to astrometry.net. A NaN value is sent as the host gave it. */
export interface NovaSolveHints {
  /** Centre of the search, degrees. Used only together with `dec`. */
  ra?: number;
  dec?: number;
  /** Search radius in degrees (2 when absent). */
  radius?: number;
  /** Field width range in degrees; when neither bound is given, 0.1 to 180 degrees is searched. */
  scale_lower?: number;
  scale_upper?: number;
}

/** How far the field width typed by the user may be off, either way. */
const FOV_TOLERANCE = 0.2;

/** The field width range sent to astrometry.net for a field width (FOV, degrees) typed by the user. */
export function fovScaleHints(fovDeg: number): Pick<NovaSolveHints, 'scale_lower' | 'scale_upper'> {
  return {
    scale_lower: Math.max(0.1, fovDeg * (1 - FOV_TOLERANCE)),
    scale_upper: Math.min(180, fovDeg * (1 + FOV_TOLERANCE)),
  };
}

/** The radius searched around the target object typed by the user, degrees. */
const TARGET_RADIUS_DEG = 2;

/** The hint sent to astrometry.net: the target object's position and the field width typed by the user, if any. */
export function onlineSolveHints(
  target: { ra: number; dec: number } | null | undefined,
  fovDeg: number | null | undefined,
): NovaSolveHints {
  return {
    ...(target ? { ra: target.ra, dec: target.dec, radius: TARGET_RADIUS_DEG } : {}),
    ...(fovDeg != null ? fovScaleHints(fovDeg) : {}),
  };
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

/**
 * Where a submitted job is: `pending` and `solving` run, the others are final. `timeout` is not a failure: the app
 * stopped following the job, which astrometry.net goes on solving (`resume` follows it again; once solved, it can be
 * reused from the list of submissions). It carries no `error`.
 */
export type NovaJobState = 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';

/** What `GET /api/solve-plate/:id` returns. */
export interface NovaJobStatus {
  jobId: string;
  status: NovaJobState;
  correspondences?: NovaCorrespondence[];
  error?: string;
  /** Normalised ids of the known objects in the field, e.g. `["NGC5457", "M101"]`. */
  dsoIds?: string[];
  /** The astrometry.net submission once the picture is sent; `resume` follows it again after a restart. */
  submissionId?: number;
}

/** Outcome of reusing an existing astrometry.net job for a new picture. */
export interface NovaReuseResult {
  success: boolean;
  correspondences?: NovaCorrespondence[];
  dsoIds?: string[];
  error?: string;
}

// ─── Solvers installed next to the server ────────────────────────────────────

/** A solver program the server runs on the user's machine. */
export type LocalSolverName = 'astap' | 'solve-field';

/** What a local solver is told about the picture; every field is optional. */
export interface LocalSolveHints {
  /** Centre of the search, degrees. */
  ra?: number;
  dec?: number;
  /** Field of view, degrees. */
  fov?: number;
  /** Search radius, degrees. */
  radius?: number;
}

/** Where a local solve job is. `pending` and `solving` run; the server's own states are passed through. */
export interface LocalSolveJobStatus {
  status: string;
  result?: PlateSolveResult;
  error?: string;
}

/** What a probe checks: a solver program, or the folder of astrometry index files. */
export type ProbeKind = LocalSolverName | 'data-dir';

/** What a probe is asked. A program probe sends `path`, the folder probe sends `dir`. */
export interface ProbeRequest {
  path?: string;
  dir?: string;
  /** Run the program (or list the folder) through WSL. */
  useWSL?: boolean;
}

/** What a probe answers: `ok`, then `output` or `version`; or the failure with its exit `code` (-1: not found) and text. */
export interface ProbeResponse {
  ok: boolean;
  output?: string;
  version?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
}

/**
 * The solvers installed next to the server (ASTAP, solve-field). A failed request rejects with a
 * `DomainError`.
 */
export interface LocalSolverApi {
  /** Starts a solve in the background and returns its job id. A 429 rejects with kind `rateLimited`. */
  submit(
    solver: LocalSolverName,
    file: FileSource,
    hints?: LocalSolveHints,
    options?: Pick<TransferOptions, 'cancel'>,
  ): Promise<string>;
  /** The state of a job. Throws `notFound` (`JOB_NOT_FOUND`) for an unknown id, `rateLimited` when polled too fast. */
  poll(solver: LocalSolverName, jobId: string): Promise<LocalSolveJobStatus>;
  /** Asks the server to stop a job. */
  cancel(solver: LocalSolverName, jobId: string): Promise<void>;
  /** Checks that a program runs (or that a folder lists), as the settings dialog does. */
  probe(kind: ProbeKind, request: ProbeRequest): Promise<ProbeResponse>;
}
