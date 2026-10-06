/**
 * Import of already-solved files: a FITS or a TIFF whose header holds the plate solution. The
 * service reads the coordinates, turns them into star correspondences against the catalogue the
 * host passes in, and (for `convert`) turns the decoded pixels into a PNG through the
 * `ImageCodec` port. It has no database and no file access.
 */
import { DomainError } from '../domain/errors';
import type {
  ConvertSolvedResult,
  DimensionWarning,
  SolvedCaptureMetadata,
  SolvedFile,
  SolveWcsRequest,
  SolveWcsResult,
} from '../domain/solved-import';
import type { ImageCodec } from '../ports/image-codec';
import {
  decodeRawAstroImage,
  UnsupportedFitsError,
  UnsupportedRawFormatError,
  UnsupportedTiffError,
} from '../raw-decode/index';
import {
  extractWCS,
  wcsToCorrespondencesWithCatalog,
  type CatalogStar,
  type WCSData,
} from '../wcs';

/** The catalogue stars used to match a solution (every magnitude), or a function that returns them. */
export type CatalogStarSource =
  readonly CatalogStar[] | (() => readonly CatalogStar[] | Promise<readonly CatalogStar[]>);

export interface SolvedImportServiceDeps {
  images: ImageCodec;
  stars: CatalogStarSource;
}

export interface SolvedImportService {
  /**
   * Reads the solution of a FITS or TIFF file and returns the star correspondences, rescaled to
   * the target picture size when one is given. A file without a usable solution is a result
   * (`success: false` and a code), not an error. Throws `invalid` (`NO_FILE`) when no file is
   * given and `invalid` (`UNSUPPORTED_FORMAT`) for an extension other than .tif, .tiff, .fits
   * or .fit.
   */
  solveWcs(request: SolveWcsRequest): Promise<SolveWcsResult>;
  /**
   * Decodes a FITS or TIFF file to a PNG and returns it with the solution its header holds, if
   * any. Throws `invalid` (`NO_FILE`, `UNSUPPORTED_FORMAT`) like `solveWcs`, and `invalid`
   * (`UNSUPPORTED_RAW_FORMAT`, with the decoder's message) for a layout that cannot be decoded.
   */
  convert(file: SolvedFile): Promise<ConvertSolvedResult>;
}

const ALLOWED_EXTENSIONS = new Set(['.tif', '.tiff', '.fits', '.fit']);

/** Lower-case extension with its dot ('' when there is none), as `path.extname` gives it. */
function extensionOf(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** Checks the file and returns its extension. */
function requireFile(file: SolvedFile): string {
  if (!file || typeof file.fileName !== 'string' || !(file.bytes instanceof Uint8Array)) {
    throw new DomainError('invalid', 'No file provided', { code: 'NO_FILE' });
  }
  const ext = extensionOf(file.fileName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new DomainError('invalid', `Unsupported format: ${ext}`, { code: 'UNSUPPORTED_FORMAT' });
  }
  return ext;
}

/** The header fields of a solved file that describe the capture, only those present. */
function metadataOf(wcs: WCSData | null): SolvedCaptureMetadata {
  return {
    ...(wcs?.dateObs ? { dateObs: wcs.dateObs } : {}),
    ...(wcs?.expTime !== undefined ? { expTime: wcs.expTime } : {}),
    ...(wcs?.stackCnt !== undefined ? { stackCnt: wcs.stackCnt } : {}),
    ...(wcs?.filter ? { filter: wcs.filter } : {}),
    ...(wcs?.captureDetails ? { captureDetails: wcs.captureDetails } : {}),
  };
}

export function createSolvedImportService(deps: SolvedImportServiceDeps): SolvedImportService {
  const { images } = deps;

  // Resolved on every call: a loader caches its own result, and one that failed is retried.
  const catalog = async (): Promise<CatalogStar[]> => [
    ...(await (typeof deps.stars === 'function' ? deps.stars() : deps.stars)),
  ];

  // Standard FITS files from PixInsight/Siril use the FITS Y convention (Y=1 is the bottom row,
  // Y increases upward), opposite to the display convention (Y=0 is the top row), hence `true`.
  const correspondencesOf = async (wcs: WCSData, width: number, height: number) =>
    wcsToCorrespondencesWithCatalog(wcs, await catalog(), width, height, true);

  return {
    async solveWcs(request) {
      const ext = requireFile(request);
      const wcs = extractWCS(request.bytes, ext);
      if (!wcs) return { success: false, code: 'NO_WCS_DATA' };

      // The size comes from the NAXIS header keywords; for a TIFF without them, from the codec.
      let imageWidth = wcs.NAXIS1;
      let imageHeight = wcs.NAXIS2;
      if ((ext === '.tif' || ext === '.tiff') && (!imageWidth || !imageHeight)) {
        try {
          const info = await images.probe(request.bytes);
          imageWidth = info.width || imageWidth;
          imageHeight = info.height || imageHeight;
        } catch {
          // An unreadable TIFF has no size; reported below.
        }
      }
      if (!imageWidth || !imageHeight) return { success: false, code: 'NO_IMAGE_DIMENSIONS' };

      const correspondences = await correspondencesOf(wcs, imageWidth, imageHeight);
      if (correspondences.length < 3) return { success: false, code: 'NOT_ENOUGH_CATALOG_STARS' };

      // Rescale to the target (displayed) size when it is given and differs.
      const targetWidth = request.targetWidth ?? 0;
      const targetHeight = request.targetHeight ?? 0;
      let finalCorrespondences = correspondences;
      let dimensionWarning: DimensionWarning | undefined;
      if (
        targetWidth > 0 &&
        targetHeight > 0 &&
        (targetWidth !== imageWidth || targetHeight !== imageHeight)
      ) {
        const sourceAspect = imageWidth / imageHeight;
        const targetAspect = targetWidth / targetHeight;
        dimensionWarning = {
          sourceW: imageWidth,
          sourceH: imageHeight,
          targetW: targetWidth,
          targetH: targetHeight,
          aspectMismatch: Math.abs(sourceAspect - targetAspect) / sourceAspect > 0.01,
        };
        const scaleX = targetWidth / imageWidth;
        const scaleY = targetHeight / imageHeight;
        finalCorrespondences = correspondences.map((c) => ({
          ...c,
          photoX: c.photoX * scaleX,
          photoY: c.photoY * scaleY,
        }));
      }

      return {
        success: true,
        correspondences: finalCorrespondences,
        sourceWidth: imageWidth,
        sourceHeight: imageHeight,
        ...(dimensionWarning ? { dimensionWarning } : {}),
        ...metadataOf(wcs),
      };
    },

    async convert(file) {
      const ext = requireFile(file);

      let decoded: Awaited<ReturnType<typeof decodeRawAstroImage>>;
      try {
        decoded = await decodeRawAstroImage(file.bytes, ext, images);
      } catch (err) {
        if (
          err instanceof UnsupportedRawFormatError ||
          err instanceof UnsupportedTiffError ||
          err instanceof UnsupportedFitsError
        ) {
          throw new DomainError('invalid', err.message, { code: 'UNSUPPORTED_RAW_FORMAT' });
        }
        throw err;
      }

      // WCS and capture metadata; no rescale is needed since the PNG has the file's own size.
      const wcs = extractWCS(file.bytes, ext);
      let correspondences: ConvertSolvedResult['correspondences'];
      if (wcs) correspondences = await correspondencesOf(wcs, decoded.width, decoded.height);
      const success = !!correspondences && correspondences.length >= 3;

      return {
        success,
        ...(success ? { correspondences } : { code: 'NO_WCS_DATA' as const }),
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        width: decoded.width,
        height: decoded.height,
        png: decoded.png,
        ...metadataOf(wcs),
      };
    },
  };
}
