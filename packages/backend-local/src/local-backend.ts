/**
 * The backend of the phone: the same `Backend` as the HTTP one, made of the services themselves, with no
 * server. Everything the platform provides arrives through `deps` (no import of `@capacitor/*` here), so
 * the backend contract runs on it in Node like on the HTTP backend.
 */
import type { Backend, CancelSignal, FileSource } from '@myastrosky/core/backend';
import { backupFileName } from '@myastrosky/core/domain/backup';
import { DomainError } from '@myastrosky/core/domain/errors';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import type { BackupFile } from '@myastrosky/core/services/backup';
import type { Services } from '@myastrosky/core/services/create-services';
import { shareFileName } from '@myastrosky/core/domain/shared-sky';
import type { RangeSource } from '@myastrosky/core/zip-ranges';

export interface LocalBackendDeps {
  /** What `createServices` returns, built on the phone's database, blob store and image codec. */
  services: Services;
  /** The address of a stored photo or thumbnail file, for an image's `src`. */
  files: { url(fileName: string): string };
  /** The address of the star catalogue file. */
  starCatalogUrl: string;
  /** Opens a ZIP archive read by pieces. */
  openZip(source: RangeSource): Promise<BundleReader>;
  /** The largest file read whole (a `.json` backup, or a file that cannot be read by pieces); larger is
   *  refused with `BACKUP_TOO_LARGE` before it is read. No limit when absent. */
  maxWholeFileBytes?: number;
  /** The largest photo file (a picture, or a FITS / TIFF / XISF read to convert or solve it); larger is refused
   *  with `PHOTO_TOO_LARGE` before it is read. No limit when absent. */
  maxPhotoBytes?: number;
  /**
   * Builds the ZIP archive `name` from the files `write` adds, then hands it to the user (the share sheet on the
   * phone). The archive goes to a file as it is written; nothing is handed over when `write` fails.
   */
  saveArchive(name: string, write: (writer: BundleWriter) => Promise<void>): Promise<void>;
  now: () => Date;
}

/** Core has no `DOMException`: this carries the name the callers test, like the HTTP backend's. */
const aborted = (): Error => Object.assign(new Error('Aborted'), { name: 'AbortError' });

function throwIfCancelled(cancel: CancelSignal | undefined): void {
  if (cancel?.aborted) throw aborted();
}

/**
 * A failure that is neither a `DomainError` nor a cancel (a file that cannot be read, a decoder or network error) is
 * what the server answers with a 500: on the HTTP backend it arrives as `upstream` with its message and a code the
 * screen translates. Here it becomes the same, with `INTERNAL_ERROR`, so its English message never reaches a screen.
 */
function toDomainError(err: unknown): unknown {
  if (err instanceof DomainError || (err as { name?: string } | null)?.name === 'AbortError') {
    return err;
  }
  reportError('Local backend call failed', err);
  return new DomainError('upstream', err instanceof Error ? err.message : String(err), {
    code: 'INTERNAL_ERROR',
  });
}

/** Every method of every member, with its failures passed through `toDomainError`; a synchronous one stays so. */
function withDomainErrors(backend: Backend): Backend {
  const wrapMember = (member: object): object =>
    Object.fromEntries(
      Object.entries(member).map(([name, value]) => [
        name,
        typeof value !== 'function'
          ? value
          : (...args: unknown[]) => {
              let result: unknown;
              try {
                result = (value as (...a: unknown[]) => unknown).apply(member, args);
              } catch (err) {
                throw toDomainError(err);
              }
              return result instanceof Promise
                ? result.catch((err: unknown) => {
                    throw toDomainError(err);
                  })
                : result;
            },
      ]),
    );
  return Object.fromEntries(
    Object.entries(backend).map(([name, member]) => [name, wrapMember(member as object)]),
  ) as unknown as Backend;
}

export function createLocalBackend(deps: LocalBackendDeps): Backend {
  const {
    services,
    files,
    starCatalogUrl,
    openZip,
    saveArchive,
    now,
    maxWholeFileBytes,
    maxPhotoBytes,
  } = deps;

  const readWhole = async (file: FileSource) => {
    if (maxWholeFileBytes !== undefined && file.size > maxWholeFileBytes) {
      throw new DomainError('invalid', 'Backup too large', { code: 'BACKUP_TOO_LARGE' });
    }
    return file.read();
  };
  // A ZIP is read by pieces when the file can be; otherwise it is read whole, once.
  const rangesOf = async (file: FileSource): Promise<RangeSource> => {
    const { readRange } = file;
    if (readRange) return { size: file.size, read: (start, end) => readRange(start, end) };
    const bytes = await readWhole(file);
    return { size: bytes.byteLength, read: async (start, end) => bytes.subarray(start, end) };
  };
  const backupFileOf = (file: FileSource): BackupFile => ({
    name: file.name,
    read: () => readWhole(file),
    openZip: async () => openZip(await rangesOf(file)),
  });
  const readPhoto = async (file: FileSource) => {
    if (maxPhotoBytes !== undefined && file.size > maxPhotoBytes) {
      throw new DomainError('invalid', 'Photo too large', { code: 'PHOTO_TOO_LARGE' });
    }
    return file.read();
  };
  const solvedFileOf = async (file: FileSource) => ({
    fileName: file.name,
    bytes: await readPhoto(file),
  });

  /** The packages inspected and not yet opened, by ticket: the file stays where it is and is read again to open it. */
  const inspected = new Map<string, BundleReader>();
  let tickets = 0;
  /** A file that is no ZIP at all is, for the user, a file that is not a shared sky. */
  const openPackage = async (file: FileSource): Promise<BundleReader> => {
    try {
      return await openZip(await rangesOf(file));
    } catch (err) {
      if (err instanceof Error && /Invalid backup archive/.test(err.message)) {
        throw new DomainError('invalid', 'This file is not a shared sky', {
          code: 'NOT_A_SHARED_SKY',
        });
      }
      throw err;
    }
  };

  return withDomainErrors({
    capabilities: { localSolvers: false },
    files,
    catalog: { starCatalogUrl: async () => starCatalogUrl },
    plans: services.plans,
    photos: {
      ...services.photos,
      async upload(file, fields, options) {
        throwIfCancelled(options?.cancel);
        const bytes = await readPhoto(file);
        // Reading the file is the transfer here: a cancel is honoured until it ends, like an HTTP upload's.
        throwIfCancelled(options?.cancel);
        const { photo } = await services.photos.upload({ name: file.name, bytes }, fields);
        options?.onProgress?.(1);
        return photo;
      },
    },
    gear: services.gear,
    dsoOverrides: services.dsoOverrides,
    poiCategories: services.poiCategories,
    skyRegions: services.skyRegions,
    settings: services.settings,
    stars: services.stars,
    horizon: services.horizon,
    identify: services.identify,
    version: services.version,
    novaSolve: {
      ...services.novaSolve,
      async submit(file, hints) {
        return services.novaSolve.submit(await solvedFileOf(file), hints);
      },
      async resume(file, submissionId) {
        return services.novaSolve.resume(await solvedFileOf(file), submissionId);
      },
      async reuse(file, jobId) {
        return services.novaSolve.reuse(await solvedFileOf(file), jobId);
      },
    },
    solvedImport: {
      async solveWcs(file, target) {
        return services.solvedImport.solveWcs({
          ...(await solvedFileOf(file)),
          targetWidth: target?.width,
          targetHeight: target?.height,
        });
      },
      async convert(file, options) {
        throwIfCancelled(options?.cancel);
        const solved = await solvedFileOf(file);
        throwIfCancelled(options?.cancel);
        const result = await services.solvedImport.convert(solved);
        options?.onProgress?.(1);
        return result;
      },
    },
    sharedSkies: {
      senderName: () => services.sharedSkies.senderName(),
      list: () => services.sharedSkies.list(),
      listPhotos: (skyId) => services.sharedSkies.listPhotos(skyId),
      remove: (skyId) => services.sharedSkies.remove(skyId),
      makeMissingMediums: () => services.sharedSkies.makeMissingMediums(),
      async exportToUser(request) {
        // Refused before a file is made and handed over.
        await services.sharedSkies.checkShare(request);
        await saveArchive(shareFileName(request.senderName), (writer) =>
          services.sharedSkies.exportTo(writer, request),
        );
      },
      async inspect(file, options) {
        throwIfCancelled(options?.cancel);
        const reader = await openPackage(file);
        const preview = await services.sharedSkies.inspect(reader);
        // Nothing is transferred here: the file is read where it is.
        options?.onProgress?.(1);
        const ticket = `package-${++tickets}`;
        inspected.set(ticket, reader);
        return { ticket, preview };
      },
      async open(ticket, options) {
        const reader = inspected.get(ticket);
        if (!reader) {
          throw new DomainError('notFound', 'This shared sky must be opened again', {
            code: 'SHARED_SKY_TICKET_EXPIRED',
          });
        }
        inspected.delete(ticket);
        return services.sharedSkies.open(reader, {
          cancel: options?.cancel,
          onProgress: (done, total) => options?.onProgress?.(total > 0 ? done / total : 1),
        });
      },
      async discard(ticket) {
        inspected.delete(ticket);
      },
    },
    backup: {
      async exportToUser(request) {
        await saveArchive(backupFileName(now()), (writer) =>
          services.backup.exportTo(writer, request),
        );
      },
      async preview(file) {
        return services.backup.previewFile(backupFileOf(file));
      },
      async restore(file, options) {
        return services.backup.importFile(backupFileOf(file), options);
      },
    },
  });
}
