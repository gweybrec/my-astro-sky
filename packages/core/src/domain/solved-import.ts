// API shapes of the import of already-solved files (FITS, TIFF with coordinates).

import type { Correspondence } from '../wcs';

/** A file the user picked: its name (the extension tells FITS from TIFF) and its bytes. */
export interface SolvedFile {
  fileName: string;
  bytes: Uint8Array;
}

/** `solveWcs` input: the file, and the size of the picture the correspondences must fit, when known. */
export interface SolveWcsRequest extends SolvedFile {
  /** Width of the displayed picture in pixels; 0 or absent: no rescale. */
  targetWidth?: number;
  /** Height of the displayed picture in pixels; 0 or absent: no rescale. */
  targetHeight?: number;
}

/** What the header of a solved file says about the capture, when it says it. */
export interface SolvedCaptureMetadata {
  /** DATE-OBS, UTC ISO 8601. */
  dateObs?: string;
  /** EXPTIME, in seconds. */
  expTime?: number;
  /** STACKCNT, the number of stacked frames. */
  stackCnt?: number;
  filter?: string;
  /** Parsed capture fields (gain, offset, iso, ccdTemp, setTemp, binning), keyed by field id. */
  captureDetails?: Record<string, number | string>;
}

/** The size of the file against the size of the displayed picture, when they differ. */
export interface DimensionWarning {
  sourceW: number;
  sourceH: number;
  targetW: number;
  targetH: number;
  /** The aspect ratios differ by more than 1 %. */
  aspectMismatch: boolean;
}

/** Why a file gave no solution. Not an error of the caller: the file is simply not usable. */
export type SolveWcsFailureCode =
  'NO_WCS_DATA' | 'NO_IMAGE_DIMENSIONS' | 'NOT_ENOUGH_CATALOG_STARS';

export type SolveWcsResult =
  | ({
      success: true;
      correspondences: Correspondence[];
      sourceWidth: number;
      sourceHeight: number;
      dimensionWarning?: DimensionWarning;
    } & SolvedCaptureMetadata)
  | { success: false; code: SolveWcsFailureCode };

/** A raw file converted to a picture, with the solution its header holds (`success` false: none was found; the picture is still there). */
export type ConvertSolvedResult = {
  success: boolean;
  /** Present when `success` is true. */
  correspondences?: Correspondence[];
  /** Present (`NO_WCS_DATA`) when `success` is false. */
  code?: 'NO_WCS_DATA';
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  /** The picture: 8-bit PNG, a faithful linear mapping of the file's pixels. */
  png: Uint8Array;
} & SolvedCaptureMetadata;
