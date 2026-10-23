/** The phone's backend on the real Capacitor plugins. Loaded only on a native platform. */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { Backend } from '@myastrosky/core/backend';
import type { CapacitorFilesystem } from '@myastrosky/backend-local/capacitor-blob-store';
import type { CapacitorSqliteConnection } from '@myastrosky/backend-local/capacitor-sqlite-db';
import {
  createPhoneBackend,
  type PhonePlatform,
  type PlatformFetch,
} from '@myastrosky/backend-local/phone-backend';

const DATABASE = 'myastrosky';

type WindowWithWebFetch = Window & { CapacitorWebFetch?: typeof fetch };

/** The app's own files and the stored pictures go through the WebView's fetch; the internet through Capacitor's. */
const platformFetch: PlatformFetch = (url, init) => {
  const w = window as WindowWithWebFetch;
  const webFetch = w.CapacitorWebFetch ?? w.fetch.bind(w);
  const f = url.startsWith(`${location.origin}/`) ? webFetch : w.fetch.bind(w);
  return f(url, init as RequestInit) as ReturnType<PlatformFetch>;
};

/** Opens the database; after a page reload (a language change) the native connection is still there. */
async function openDatabase(): Promise<CapacitorSqliteConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const exists = (await sqlite.isConnection(DATABASE, false)).result;
  const connection =
    consistent && exists
      ? await sqlite.retrieveConnection(DATABASE, false)
      : await sqlite.createConnection(DATABASE, false, 'no-encryption', 1, false);
  if (!(await connection.isDBOpen()).result) await connection.open();
  return connection as unknown as CapacitorSqliteConnection;
}

export async function createNativePhoneBackend(): Promise<Backend> {
  const platform: PhonePlatform = {
    sqliteConnection: await openDatabase(),
    filesystem: Filesystem as unknown as CapacitorFilesystem,
    convertFileSrc: (uri) => Capacitor.convertFileSrc(uri),
    share: Share,
    fetch: platformFetch,
    crypto: window.crypto as never,
    indexedDB: window.indexedDB,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    directories: { data: Directory.Data, cache: Directory.Cache },
    baseUrl: location.origin,
  };
  return createPhoneBackend(platform);
}
