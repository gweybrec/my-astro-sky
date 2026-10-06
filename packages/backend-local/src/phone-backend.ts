/**
 * Assembles the whole backend of the phone: the adapters over the plugin objects the shell passes in, the
 * schema and the default categories (as `server/app.ts` does at start-up), the services, and the local
 * backend on top. Nothing here imports a Capacitor package: the shell hands over the real plugins.
 */
import type { Backend } from '@myastrosky/core/backend';
import { initSchema } from '@myastrosky/core/db/schema';
import type { ImageCodec } from '@myastrosky/core/ports/image-codec';
import { createServices } from '@myastrosky/core/services/create-services';
import { newZipBundle, openZipBundle } from './bundle-fflate';
import { createBrowserImageCodec } from './browser-image-codec';
import { createBundledCatalogs } from './bundled-catalogs';
import {
  createCapacitorBlobStore,
  writeFileInPieces,
  type CapacitorFilesystem,
} from './capacitor-blob-store';
import { createCapacitorSqliteDb, type CapacitorSqliteConnection } from './capacitor-sqlite-db';
import { createFetchHttpClient, type FetchLike, type FetchResponseLike } from './fetch-http-client';
import { createLocalBackend } from './local-backend';
import {
  createWebCryptoSecretCodec,
  type SecretKeyStore,
  type WebCryptoLike,
} from './webcrypto-secret-codec';

/** The largest backup the phone opens: an archive is held in memory. */
export const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;

/** The method of `@capacitor/share` that `saveFile` uses. */
export interface CapacitorShare {
  share(options: { title?: string; url?: string; dialogTitle?: string }): Promise<unknown>;
}

/** The WebView's `fetch` (the one Capacitor patches), as far as the adapters use it. */
export type PlatformFetch = (
  url: string,
  init?: Parameters<FetchLike>[1],
) => Promise<FetchResponseLike & { ok: boolean; json(): Promise<unknown> }>;

export interface PhonePlatform {
  sqliteConnection: CapacitorSqliteConnection;
  filesystem: CapacitorFilesystem;
  /** `Capacitor.convertFileSrc`. */
  convertFileSrc: (uri: string) => string;
  share: CapacitorShare;
  fetch: PlatformFetch;
  crypto: WebCryptoLike;
  indexedDB: IDBFactory;
  /** Replaces the IndexedDB key store of the astrometry key (tests, where there is no IndexedDB). */
  keyStore?: SecretKeyStore;
  /** A new unique id (`crypto.randomUUID`). */
  newId: () => string;
  /** The clock, in milliseconds since the epoch. */
  now: () => number;
  /** The Filesystem plugin's directories: a private one for pictures, the cache one for files to share. */
  directories: { data: string; cache: string };
  /** The app's own address, without a trailing slash (`''` for relative addresses): where `data/` and `gear/` are. */
  baseUrl: string;
  /** Bytes per piece when a file is written (default: the blob store's own). */
  blobPieceBytes?: number;
  /** Replaces the browser codec (the contract test passes the server's `sharp` one). */
  images?: ImageCodec;
}

/** The folder of picture files inside the data directory. */
const BLOB_FOLDER = 'uploads';

export async function createPhoneBackend(platform: PhonePlatform): Promise<Backend> {
  const { filesystem, now, baseUrl, directories } = platform;

  const db = createCapacitorSqliteDb(platform.sqliteConnection);
  await initSchema(db);

  const blobs = createCapacitorBlobStore({
    filesystem,
    convertFileSrc: platform.convertFileSrc,
    fetch: platform.fetch,
    directory: directories.data,
    folder: BLOB_FOLDER,
    pieceBytes: platform.blobPieceBytes,
  });
  await blobs.init();

  const catalogs = createBundledCatalogs({ fetch: platform.fetch, baseUrl });
  const services = createServices({
    db,
    newId: platform.newId,
    secrets: createWebCryptoSecretCodec({
      crypto: platform.crypto,
      indexedDB: platform.indexedDB,
      keyStore: platform.keyStore,
    }),
    env: () => undefined,
    platform: { isWindows: false },
    gearCatalog: await catalogs.gearCatalog(),
    images: platform.images ?? createBrowserImageCodec(),
    blobs,
    stars: catalogs.stars,
    catalogStars: catalogs.catalogStars,
    http: createFetchHttpClient({ fetch: platform.fetch }),
    now,
  });
  // First run: the default POI categories, before anything can list them.
  await services.poiCategories.ensureDefaults();

  return createLocalBackend({
    services,
    files: { url: (fileName) => blobs.url(fileName) },
    starCatalogUrl: `${baseUrl}/data/stars.14.json`,
    openZip: (bytes) => openZipBundle(bytes, { maxArchiveBytes: MAX_ARCHIVE_BYTES }),
    newZip: newZipBundle,
    // The share sheet takes a file address: write the file in the cache directory, then share it.
    saveFile: async (name, bytes) => {
      await filesystem
        .mkdir({ path: 'exports', directory: directories.cache, recursive: true })
        .catch(() => undefined);
      const path = `exports/${name}`;
      await writeFileInPieces(filesystem, directories.cache, path, bytes, platform.blobPieceBytes);
      const { uri } = await filesystem.getUri({ path, directory: directories.cache });
      await platform.share.share({ title: name, url: uri, dialogTitle: name });
    },
    now: () => new Date(now()),
  });
}
