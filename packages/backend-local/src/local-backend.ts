/**
 * The backend of the phone: the same `Backend` as the HTTP one, made of the services themselves, with no
 * server. Everything the platform provides arrives through `deps` (no import of `@capacitor/*` here), so
 * the backend contract runs on it in Node like on the HTTP backend.
 */
import type { Backend, CancelSignal, FileSource } from '@myastrosky/core/backend';
import { backupFileName } from '@myastrosky/core/domain/backup';
import { DomainError } from '@myastrosky/core/domain/errors';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import type { BackupFile } from '@myastrosky/core/services/backup';
import type { Services } from '@myastrosky/core/services/create-services';
import type { RangeSource } from './bundle-fflate';

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
  /** Builds a ZIP archive in memory. */
  newZip(): { writer: BundleWriter; finish(): Promise<Uint8Array> };
  /** Hands a file to the user (the share sheet on the phone). */
  saveFile(name: string, bytes: Uint8Array): Promise<void>;
  now: () => Date;
}

/** Core has no `DOMException`: this carries the name the callers test, like the HTTP backend's. */
const aborted = (): Error => Object.assign(new Error('Aborted'), { name: 'AbortError' });

function throwIfCancelled(cancel: CancelSignal | undefined): void {
  if (cancel?.aborted) throw aborted();
}

export function createLocalBackend(deps: LocalBackendDeps): Backend {
  const { services, files, starCatalogUrl, openZip, newZip, saveFile, now, maxWholeFileBytes } =
    deps;

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
  const solvedFileOf = async (file: FileSource) => ({
    fileName: file.name,
    bytes: await file.read(),
  });

  return {
    capabilities: { localSolvers: false },
    files,
    catalog: { starCatalogUrl: async () => starCatalogUrl },
    plans: services.plans,
    photos: {
      ...services.photos,
      async upload(file, fields, options) {
        throwIfCancelled(options?.cancel);
        const { photo } = await services.photos.upload(
          { name: file.name, bytes: await file.read() },
          fields,
        );
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
        const result = await services.solvedImport.convert(await solvedFileOf(file));
        options?.onProgress?.(1);
        return result;
      },
    },
    backup: {
      async exportToUser(request) {
        const zip = newZip();
        await services.backup.exportTo(zip.writer, request);
        await saveFile(backupFileName(now()), await zip.finish());
      },
      async preview(file) {
        return services.backup.previewFile(backupFileOf(file));
      },
      async restore(file, options) {
        return services.backup.importFile(backupFileOf(file), options);
      },
    },
  };
}
