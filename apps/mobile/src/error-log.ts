import { errorCauses } from '@myastrosky/core/platform/error-report';
/**
 * The phone's error log: one JSON line per error in a file of the app's private folder, the twin of
 * the desktop's log file (electron/error-logger.ts). It stays on the phone: nothing sends it; the
 * user shares it from À propos when reporting a bug. It holds the last `2 × RECORDS_PER_FILE`
 * errors (the current file and the one before), so it never grows.
 */
import type { ErrorTicket } from '@myastrosky/core/platform/error-report';
import {
  redactSecrets,
  removeUserData,
  sanitizeContext,
  type Json,
} from '@myastrosky/core/platform/log-sanitize';

export const RECORDS_PER_FILE = 150;
const FOLDER = 'logs';
const CURRENT = `${FOLDER}/errors.jsonl`;
const PREVIOUS = `${FOLDER}/errors.1.jsonl`;

/** The part of Capacitor's Filesystem plugin the log uses (text files, UTF-8). */
export interface ErrorLogFilesystem {
  appendFile(options: {
    path: string;
    data: string;
    directory: string;
    encoding: string;
  }): Promise<unknown>;
  readFile(options: {
    path: string;
    directory: string;
    encoding: string;
  }): Promise<{ data: string | Blob }>;
  rename(options: {
    from: string;
    to: string;
    directory: string;
    toDirectory?: string;
  }): Promise<unknown>;
  deleteFile(options: { path: string; directory: string }): Promise<unknown>;
  mkdir(options: { path: string; directory: string; recursive?: boolean }): Promise<unknown>;
}

export interface ErrorLogRecord {
  timestamp: string;
  appVersion: string;
  platform: string;
  category: string;
  code: string;
  ref: string;
  message: string;
  stack?: string;
  /** What lies under the error (its causes), cleaned as the message. */
  causes?: string[];
  context?: Json;
}

export interface ErrorLog {
  /** Appends one error; never throws, and writes one record after the other. */
  record(
    category: string,
    error: unknown,
    details: Record<string, unknown> | undefined,
    ticket: ErrorTicket,
  ): Promise<void>;
  /** The whole log, oldest first, as JSON lines; empty when nothing was logged. */
  read(): Promise<string>;
}

const MAX_TEXT = 4096;

function cut(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…[truncated]` : text;
}

export function createErrorLog(options: {
  fs: ErrorLogFilesystem;
  /** The plugin's `Directory.Data`, a folder only the app can read. */
  directory: string;
  version: string;
  platform: string;
  now?: () => Date;
  /** The astrometry.net key, removed wherever it appears. */
  secrets?: () => readonly string[];
}): ErrorLog {
  const { fs, directory } = options;
  const now = options.now ?? (() => new Date());
  const encoding = 'utf8';
  let count: number | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function readText(path: string): Promise<string> {
    try {
      const { data } = await fs.readFile({ path, directory, encoding });
      return typeof data === 'string' ? data : await data.text();
    } catch {
      return ''; // Not written yet.
    }
  }

  async function lineCount(): Promise<number> {
    if (count === null) {
      await fs.mkdir({ path: FOLDER, directory, recursive: true }).catch(() => undefined);
      count = (await readText(CURRENT)).split('\n').filter(Boolean).length;
    }
    return count;
  }

  async function rotate(): Promise<void> {
    await fs.deleteFile({ path: PREVIOUS, directory }).catch(() => undefined);
    await fs.rename({ from: CURRENT, to: PREVIOUS, directory, toDirectory: directory });
    count = 0;
  }

  function toRecord(
    category: string,
    error: unknown,
    details: Record<string, unknown> | undefined,
    ticket: ErrorTicket,
  ): ErrorLogRecord {
    const secrets = options.secrets?.() ?? [];
    const clean = (text: string) => cut(removeUserData(redactSecrets(text, secrets)));
    const err = error instanceof Error ? error : undefined;
    const message = err
      ? err.message || err.name
      : typeof error === 'string'
        ? error
        : String(error);
    return {
      timestamp: now().toISOString(),
      appVersion: options.version,
      platform: options.platform,
      category,
      code: ticket.code,
      ref: ticket.ref,
      message: clean(message || 'Unknown error'),
      ...(err?.stack ? { stack: clean(err.stack) } : {}),
      ...(errorCauses(error).length ? { causes: errorCauses(error).map(clean) } : {}),
      ...(details ? { context: sanitizeContext(details, (s) => s, 0, secrets) } : {}),
    };
  }

  return {
    record(category, error, details, ticket) {
      let line: string;
      try {
        line = `${JSON.stringify(toRecord(category, error, details, ticket))}\n`;
      } catch {
        return queue; // A record that cannot be written as JSON is dropped, never thrown.
      }
      queue = queue
        .then(async () => {
          if ((await lineCount()) >= RECORDS_PER_FILE) await rotate();
          await fs.appendFile({ path: CURRENT, data: line, directory, encoding });
          count = (count ?? 0) + 1;
        })
        // The log must never turn one error into two: a failed write is dropped.
        .catch(() => undefined);
      return queue;
    },
    async read() {
      await queue;
      return (await readText(PREVIOUS)) + (await readText(CURRENT));
    },
  };
}
