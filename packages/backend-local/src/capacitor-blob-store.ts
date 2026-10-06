/**
 * The phone's `BlobStore`: picture files kept flat (`<folder>/<name>`) in the app's private data directory,
 * through the Filesystem plugin. The plugin writes text in base64, so a file is written in pieces; it is read
 * back through the WebView's `fetch` of the file's local address (no base64 on the way in).
 */
import type { BlobStore } from '@myastrosky/core/ports/blob-store';

/** The methods of `@capacitor/filesystem` that the adapter uses. The real plugin is assignable to this. */
export interface CapacitorFilesystem {
  writeFile(options: { path: string; data: string; directory: string }): Promise<unknown>;
  appendFile(options: { path: string; data: string; directory: string }): Promise<unknown>;
  stat(options: { path: string; directory: string }): Promise<{ size: number }>;
  deleteFile(options: { path: string; directory: string }): Promise<unknown>;
  mkdir(options: { path: string; directory: string; recursive?: boolean }): Promise<unknown>;
  getUri(options: { path: string; directory: string }): Promise<{ uri: string }>;
}

export interface CapacitorBlobStoreOptions {
  filesystem: CapacitorFilesystem;
  /** `Capacitor.convertFileSrc`: turns a `file://` address into one the WebView can load. */
  convertFileSrc: (uri: string) => string;
  fetch: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** The plugin's directory (its `Directory.Data`, a private one). */
  directory: string;
  /** The folder inside it. */
  folder: string;
}

export interface CapacitorBlobStore extends BlobStore {
  /** Resolves the folder's address once; await it before `url`. */
  init(): Promise<void>;
  /** The address of a stored file, for an image's `src`. Synchronous; `init` must have resolved. */
  url(name: string): string;
}

/** Bytes per piece written; each piece is encoded on its own, so no base64 text of a whole file exists. */
export const BLOB_PIECE_BYTES = 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

/** Writes a file in pieces of at most `BLOB_PIECE_BYTES`: the first creates (or replaces) it, the next ones are appended. */
export async function writeFileInPieces(
  filesystem: Pick<CapacitorFilesystem, 'writeFile' | 'appendFile'>,
  directory: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await filesystem.writeFile({
    path,
    data: toBase64(bytes.subarray(0, BLOB_PIECE_BYTES)),
    directory,
  });
  for (let at = BLOB_PIECE_BYTES; at < bytes.length; at += BLOB_PIECE_BYTES) {
    await filesystem.appendFile({
      path,
      data: toBase64(bytes.subarray(at, at + BLOB_PIECE_BYTES)),
      directory,
    });
  }
}

export function createCapacitorBlobStore(options: CapacitorBlobStoreOptions): CapacitorBlobStore {
  const { filesystem, convertFileSrc, directory, folder } = options;
  const doFetch = options.fetch;

  const pathOf = (name: string): string => {
    if (
      !name ||
      name.includes('/') ||
      name.includes(String.fromCharCode(92)) ||
      name.startsWith('.')
    ) {
      throw new Error(`Invalid blob name: ${name}`);
    }
    return `${folder}/${name}`;
  };

  let base: string | null = null;
  let initPromise: Promise<void> | null = null;
  const init = (): Promise<void> => {
    initPromise ??= (async () => {
      const { uri } = await filesystem.getUri({ path: folder, directory });
      base = convertFileSrc(uri.replace(/\/+$/, ''));
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
    return initPromise;
  };

  let folderReady: Promise<void> | null = null;
  const ensureFolder = (): Promise<void> => {
    folderReady ??= filesystem.mkdir({ path: folder, directory, recursive: true }).then(
      () => undefined,
      // The folder may already exist; a real problem shows on the write that follows.
      () => undefined,
    );
    return folderReady;
  };

  const sizeOf = async (name: string): Promise<number | null> => {
    try {
      return (await filesystem.stat({ path: pathOf(name), directory })).size;
    } catch {
      return null;
    }
  };

  const urlOf = (name: string): string => {
    if (base === null) throw new Error('The blob store is not initialised: await init() first');
    return `${base}/${encodeURIComponent(name)}`;
  };

  return {
    init,
    url: urlOf,

    async put(name, bytes) {
      const path = pathOf(name);
      await ensureFolder();
      try {
        await writeFileInPieces(filesystem, directory, path, bytes);
      } catch (err) {
        await filesystem.deleteFile({ path, directory }).catch(() => undefined);
        throw err;
      }
    },

    async get(name) {
      // The phone's local server answers `index.html` with status 200 for an unknown path: look first.
      if ((await sizeOf(name)) === null) return null;
      await init();
      const res = await doFetch(urlOf(name));
      if (!res.ok) throw new Error(`Could not read ${name}: status ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    size: sizeOf,

    async remove(name) {
      try {
        await filesystem.deleteFile({ path: pathOf(name), directory });
      } catch (err) {
        // A missing file is not an error.
        if ((await sizeOf(name)) !== null) throw err;
      }
    },
  };
}
