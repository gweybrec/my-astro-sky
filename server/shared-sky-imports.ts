/**
 * The shared skies being opened on the server. A package is uploaded once, to a file on disk; `inspect` reads what it
 * holds and gives back a ticket, under which the client then starts the import, follows it and, when it is over or
 * given up, discards it. The file is removed as soon as it is no longer needed, and a ticket nobody came back for is
 * dropped after a while.
 */
import fsp from 'fs/promises';
import type { CancelSignal } from '@myastrosky/core/backend';
import { DomainError, isDomainError, type DomainErrorKind } from '@myastrosky/core/domain/errors';
import type { ErrorCode } from '@myastrosky/core/domain/error-codes';
import type { SharedSky, SharedSkyPreview } from '@myastrosky/core/domain/shared-sky';
import type { SharedSkyService } from '@myastrosky/core/services/shared-skies';
import { openZipFile, type ZipFileReader } from './bundle-zip.js';
import { logServerError } from './logger.js';

/** Where an import stands, as the client polls it. */
export interface SharedSkyImportStatus {
  state: 'ready' | 'running' | 'done' | 'failed' | 'cancelled';
  /** Photos done, out of `total`. */
  done: number;
  total: number;
  /** The visit kept, once `done`. */
  sky?: SharedSky;
  /** Why it failed, once `failed`. */
  error?: { kind: DomainErrorKind; code: ErrorCode; message: string };
}

export interface SharedSkyImports {
  /**
   * Reads what the uploaded package at `filePath` holds. The file is this module's from now on: removed at once when
   * it is not a usable package (the error is thrown), else when its ticket is done with.
   */
  inspect(filePath: string): Promise<{ ticket: string; preview: SharedSkyPreview }>;
  /** Starts the import of an inspected package; it runs on after the call returns. Throws `notFound` (`SHARED_SKY_TICKET_EXPIRED`). */
  start(ticket: string): void;
  /** Where the import stands. Throws `notFound` (`SHARED_SKY_TICKET_EXPIRED`). */
  status(ticket: string): SharedSkyImportStatus;
  /** Gives up or forgets a package: a running import is cancelled and leaves nothing behind. An unknown ticket is not an error. */
  discard(ticket: string): Promise<void>;
}

interface Entry {
  filePath: string;
  reader: ZipFileReader | null;
  status: SharedSkyImportStatus;
  cancel: CancelSignal & { aborted: boolean };
  /** The running import, which never rejects. */
  job: Promise<void> | null;
  timer: ReturnType<typeof setTimeout>;
}

const ticketExpired = (): DomainError =>
  new DomainError('notFound', 'This shared sky must be opened again', {
    code: 'SHARED_SKY_TICKET_EXPIRED',
  });

export function createSharedSkyImports(deps: {
  service: Pick<SharedSkyService, 'inspect' | 'open'>;
  newId: () => string;
  /** How long a ticket nobody uses is kept, in milliseconds. */
  ttlMs?: number;
}): SharedSkyImports {
  const { service, newId } = deps;
  const ttlMs = deps.ttlMs ?? 30 * 60 * 1000;
  const entries = new Map<string, Entry>();

  /** Closes and removes the uploaded file of an entry. */
  async function releaseFile(entry: Entry): Promise<void> {
    const reader = entry.reader;
    entry.reader = null;
    await reader?.close().catch(() => undefined);
    await fsp.rm(entry.filePath, { force: true }).catch(() => undefined);
  }

  async function drop(ticket: string): Promise<void> {
    const entry = entries.get(ticket);
    if (!entry) return;
    entries.delete(ticket);
    clearTimeout(entry.timer);
    if (entry.job) {
      entry.cancel.aborted = true;
      await entry.job;
    }
    await releaseFile(entry);
  }

  const expiry = (ticket: string) => {
    const timer = setTimeout(() => void drop(ticket), ttlMs);
    // A waiting ticket must not keep the server from stopping.
    timer.unref?.();
    return timer;
  };

  const entryOf = (ticket: string): Entry => {
    const entry = entries.get(ticket);
    if (!entry) throw ticketExpired();
    return entry;
  };

  return {
    async inspect(filePath) {
      let reader: ZipFileReader | null = null;
      try {
        reader = await openZipFile(filePath);
        const preview = await service.inspect(reader);
        const ticket = newId();
        entries.set(ticket, {
          filePath,
          reader,
          status: { state: 'ready', done: 0, total: preview.photoCount },
          cancel: {
            aborted: false,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          },
          job: null,
          timer: expiry(ticket),
        });
        return { ticket, preview };
      } catch (err) {
        await reader?.close().catch(() => undefined);
        await fsp.rm(filePath, { force: true }).catch(() => undefined);
        // A file that is no ZIP at all is, for the user, a file that is not a shared sky.
        if (!isDomainError(err) && /Invalid backup archive/.test((err as Error)?.message ?? '')) {
          throw new DomainError('invalid', 'This file is not a shared sky', {
            code: 'NOT_A_SHARED_SKY',
          });
        }
        throw err;
      }
    },

    start(ticket) {
      const entry = entryOf(ticket);
      if (entry.status.state !== 'ready' || !entry.reader) return;
      const reader = entry.reader;
      entry.status = { ...entry.status, state: 'running' };
      clearTimeout(entry.timer);
      entry.job = service
        .open(reader, {
          cancel: entry.cancel,
          onProgress: (done, total) => {
            entry.status = { ...entry.status, done, total };
          },
        })
        .then(
          (sky) => {
            entry.status = { ...entry.status, state: 'done', sky };
          },
          (err: unknown) => {
            if ((err as { name?: string } | null)?.name === 'AbortError') {
              entry.status = { ...entry.status, state: 'cancelled' };
              return;
            }
            const error = isDomainError(err)
              ? { kind: err.kind, code: err.code, message: err.message }
              : {
                  kind: 'upstream' as const,
                  code: 'INTERNAL_ERROR' as const,
                  message: (err as Error)?.message ?? String(err),
                };
            if (!isDomainError(err)) logServerError('shared_sky_import_failure', err);
            entry.status = { ...entry.status, state: 'failed', error };
          },
        )
        .then(async () => {
          entry.job = null;
          await releaseFile(entry);
          // The result waits for the client to read it.
          if (entries.get(ticket) === entry) entry.timer = expiry(ticket);
        });
    },

    status(ticket) {
      return entryOf(ticket).status;
    },

    discard: drop,
  };
}
