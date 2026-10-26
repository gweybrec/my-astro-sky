/**
 * The backup the desktop app offers when a database update failed at start-up: the usual full export, read from
 * the database as it is, without running the updates. The services read rows with `SELECT *`, so a database the
 * updates have not reached is read too (a column it lacks is read as missing).
 */
import fs from 'fs';
import Database from 'better-sqlite3';
import { FULL_BACKUP_OPTIONS } from '@myastrosky/core/backup-selection';
import { createZipResponseWriter } from './bundle-zip.js';
import { createServerServices } from './create-server-services.js';
import { DB_PATH } from './server-paths.js';
import { createBetterSqliteDb } from './sqlite-adapter.js';

/** Writes the full backup of the database (and its pictures) to `outputPath`; nothing is left there on failure. */
export async function saveBackupWithoutUpdates(
  outputPath: string,
  dbPath: string = DB_PATH,
): Promise<void> {
  const conn = new Database(dbPath, { fileMustExist: true });
  const output = fs.createWriteStream(outputPath);
  const written = new Promise<void>((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
  });
  // Awaited below; a write error before then must not count as unhandled.
  written.catch(() => undefined);
  const zip = createZipResponseWriter(output, () => undefined);
  try {
    const { backup } = createServerServices(createBetterSqliteDb(conn));
    await backup.exportTo(zip, { options: FULL_BACKUP_OPTIONS });
    await zip.finalize();
    await written;
  } catch (error) {
    zip.abort();
    output.destroy();
    await written.catch(() => undefined);
    fs.rmSync(outputPath, { force: true });
    throw error;
  } finally {
    conn.close();
  }
}
