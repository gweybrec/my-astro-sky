/**
 * Import of already-solved files: a FITS, a TIFF or an XISF whose header holds the plate solution. The
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
  UnsupportedXisfError,
} from '../raw-decode/index';
import { parseXisfHeader } from '../raw-decode/xisf';
import {
  extractFITSHeaderFromFITS,
  extractFITSHeaderFromTIFF,
  parseFITSHeader,
  wcsFromHeader,
  wcsToCorrespondences,
  type WCSData,
} from '../wcs';
import {
  captureFromHeader,
  fitsDataTruncated,
  headerFacts,
  parseFitsCards,
  type FitsCard,
  type FitsHeaderFacts,
} from '../fits-header';

export interface SolvedImportServiceDeps {
  images: ImageCodec;
}

export interface SolvedImportService {
  /**
   * Reads the solution of a FITS, TIFF or XISF file and returns the star correspondences, rescaled to
   * the target picture size when one is given. A file without a usable solution is a result
   * (`success: false` and a code), not an error. Throws `invalid` (`NO_FILE`) when no file is
   * given and `invalid` (`UNSUPPORTED_FORMAT`) for an extension other than .tif, .tiff, .fits,
   * .fit or .xisf.
   */
  solveWcs(request: SolveWcsRequest): Promise<SolveWcsResult>;
  /**
   * Decodes a FITS, TIFF or XISF file to a PNG and returns it with the solution its header holds, if
   * any. Throws `invalid` (`NO_FILE`, `UNSUPPORTED_FORMAT`) like `solveWcs`, and `invalid`
   * (`UNSUPPORTED_RAW_FORMAT`, with the decoder's message) for a layout that cannot be decoded.
   */
  convert(file: SolvedFile): Promise<ConvertSolvedResult>;
}

const ALLOWED_EXTENSIONS = new Set(['.tif', '.tiff', '.fits', '.fit', '.xisf']);

/** What a file's header holds: its keywords, raw cards, plate solution (if any), facts and image size. */
interface FileHeader {
  parsed: Record<string, number | string | boolean>;
  cards: FitsCard[];
  wcs: WCSData | null;
  /** Width and height of the image, from NAXIS or the XISF image element (0 when unknown). */
  width: number;
  height: number;
  truncated: boolean;
}

const EMPTY_HEADER: FileHeader = {
  parsed: {},
  cards: [],
  wcs: null,
  width: 0,
  height: 0,
  truncated: false,
};

/**
 * The header of a FITS file, of a TIFF's ImageDescription (tag 270) or of an XISF's FITS keywords, whether or not it
 * holds a plate solution. A file whose header cannot be read gives an empty header.
 */
function readHeader(bytes: Uint8Array, ext: string): FileHeader {
  if (ext === '.xisf') {
    let header: ReturnType<typeof parseXisfHeader>;
    try {
      header = parseXisfHeader(bytes);
    } catch (err) {
      if (err instanceof UnsupportedXisfError) return EMPTY_HEADER;
      throw err;
    }
    const parsed = header.fitsKeywords;
    const wcs = wcsFromHeader(parsed);
    const width = (parsed.NAXIS1 as number) || header.image?.width || 0;
    const height = (parsed.NAXIS2 as number) || header.image?.height || 0;
    if (wcs) {
      wcs.NAXIS1 = wcs.NAXIS1 || width;
      wcs.NAXIS2 = wcs.NAXIS2 || height;
    }
    const loc = header.image?.location;
    const truncated =
      loc?.kind === 'attachment' && (loc.position ?? 0) + (loc.size ?? 0) > bytes.length;
    return { parsed, cards: header.fitsCards, wcs, width, height, truncated };
  }
  const headerStr =
    ext === '.fits' || ext === '.fit'
      ? extractFITSHeaderFromFITS(bytes)
      : extractFITSHeaderFromTIFF(bytes);
  if (!headerStr) return EMPTY_HEADER;
  const parsed = parseFITSHeader(headerStr);
  const isFits = ext === '.fits' || ext === '.fit';
  // A text that is not a FITS header (a TIFF description, a file that is not FITS) has no keyword cards.
  if (Object.keys(parsed).length === 0) return EMPTY_HEADER;
  return {
    parsed,
    cards: parseFitsCards(headerStr),
    wcs: wcsFromHeader(parsed),
    width: (parsed.NAXIS1 as number) || 0,
    height: (parsed.NAXIS2 as number) || 0,
    truncated: isFits && fitsDataTruncated(bytes.length, headerStr.length, parsed),
  };
}

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

/** What the header says about the capture, the facts used to check the file, and the raw cards. */
function metadataOf(header: FileHeader): SolvedCaptureMetadata {
  const facts: FitsHeaderFacts = headerFacts(header.parsed);
  if (header.wcs) {
    const det = Math.abs(header.wcs.CD1_1 * header.wcs.CD2_2 - header.wcs.CD1_2 * header.wcs.CD2_1);
    if (det > 0) facts.pixelScaleArcsec = Math.sqrt(det) * 3600;
  }
  return {
    ...captureFromHeader(header.parsed),
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
    ...(header.cards.length > 0 ? { fitsHeaders: header.cards } : {}),
    ...(header.truncated ? { truncated: true } : {}),
  };
}

/** The aspect/size difference between the file and the displayed picture, when a target is given and differs. */
function dimensionWarningOf(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): DimensionWarning | undefined {
  if (!width || !height || !(targetWidth > 0) || !(targetHeight > 0)) return undefined;
  if (targetWidth === width && targetHeight === height) return undefined;
  const sourceAspect = width / height;
  const targetAspect = targetWidth / targetHeight;
  return {
    sourceW: width,
    sourceH: height,
    targetW: targetWidth,
    targetH: targetHeight,
    aspectMismatch: Math.abs(sourceAspect - targetAspect) / sourceAspect > 0.01,
  };
}

export function createSolvedImportService(deps: SolvedImportServiceDeps): SolvedImportService {
  const { images } = deps;

  // Standard FITS files from PixInsight/Siril use the FITS Y convention (Y=1 is the bottom row,
  // Y increases upward), opposite to the display convention (Y=0 is the top row), hence `true`.
  // The FITS keywords of a TIFF or an XISF are read the same way.
  const correspondencesOf = (wcs: WCSData, width: number, height: number) =>
    wcsToCorrespondences(wcs, width, height, true);

  return {
    async solveWcs(request) {
      const ext = requireFile(request);
      const header = readHeader(request.bytes, ext);
      const meta = metadataOf(header);

      // The size comes from the header (NAXIS, or the XISF image); for a TIFF without them, from the codec.
      let imageWidth = header.width;
      let imageHeight = header.height;
      if ((ext === '.tif' || ext === '.tiff') && (!imageWidth || !imageHeight)) {
        try {
          const info = await images.probe(request.bytes);
          imageWidth = info.width || imageWidth;
          imageHeight = info.height || imageHeight;
        } catch {
          // An unreadable TIFF has no size; reported below.
        }
      }
      const targetWidth = request.targetWidth ?? 0;
      const targetHeight = request.targetHeight ?? 0;
      const dimensionWarning = dimensionWarningOf(
        imageWidth,
        imageHeight,
        targetWidth,
        targetHeight,
      );
      const sizeFields = {
        ...(imageWidth && imageHeight
          ? { sourceWidth: imageWidth, sourceHeight: imageHeight }
          : {}),
        ...(dimensionWarning ? { dimensionWarning } : {}),
      };

      const wcs = header.wcs;
      if (!wcs) return { success: false, code: 'NO_WCS_DATA', ...sizeFields, ...meta };
      if (!imageWidth || !imageHeight) {
        return { success: false, code: 'NO_IMAGE_DIMENSIONS', ...meta };
      }

      const correspondences = await correspondencesOf(wcs, imageWidth, imageHeight);
      if (correspondences.length < 3) {
        return { success: false, code: 'NOT_ENOUGH_CATALOG_STARS', ...sizeFields, ...meta };
      }

      // Rescale to the target (displayed) size when it is given and differs.
      const finalCorrespondences = dimensionWarning
        ? correspondences.map((c) => ({
            ...c,
            photoX: (c.photoX * targetWidth) / imageWidth,
            photoY: (c.photoY * targetHeight) / imageHeight,
          }))
        : correspondences;

      return {
        success: true,
        correspondences: finalCorrespondences,
        sourceWidth: imageWidth,
        sourceHeight: imageHeight,
        ...(dimensionWarning ? { dimensionWarning } : {}),
        ...meta,
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
          err instanceof UnsupportedFitsError ||
          err instanceof UnsupportedXisfError
        ) {
          throw new DomainError('invalid', err.message, { code: 'UNSUPPORTED_RAW_FORMAT' });
        }
        throw err;
      }

      // WCS and capture metadata; no rescale is needed since the PNG has the file's own size.
      const header = readHeader(file.bytes, ext);
      const wcs = header.wcs;
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
        ...metadataOf(header),
      };
    },
  };
}
