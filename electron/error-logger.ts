import { app, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { cleanupOldLogsSafely } from './log-retention.js';
import { buildPathAnonymizer } from './path-anonymizer.js';
import { sanitizeContext, type Json } from './sanitize-context.js';
import { diffSeenDumps } from './crash-seen.js';

export interface RendererErrorPayload {
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

interface ErrorLogRecord {
  timestamp: string;
  appVersion: string;
  appName: string;
  platform: NodeJS.Platform;
  arch: string;
  processType: 'main' | 'renderer';
  category: string;
  message: string;
  stack?: string;
  context?: Json;
}

const MAX_RECORDS_PER_FILE = 100;

// Two independent JSONL streams share the logs directory. Ordinary JS errors go to the
// "errors" stream; native/process crashes go to a separate "crash" stream so the two
// never disturb each other's rotation. Each stream filters directory listings by its own
// filename regex, so a stream only ever appends to its own files.
interface LogStream {
  prefix: string;
  re: RegExp;
  currentFile: string | null;
  currentCount: number;
}

const errorStream: LogStream = {
  prefix: 'my-astro-sky-errors',
  re: /^my-astro-sky-errors-\d{8}-\d{6}-\d{3}\.jsonl$/,
  currentFile: null,
  currentCount: 0,
};

const crashStream: LogStream = {
  prefix: 'my-astro-sky-crash',
  re: /^my-astro-sky-crash-\d{8}-\d{6}-\d{3}\.jsonl$/,
  currentFile: null,
  currentCount: 0,
};

const CRASH_SEEN_FILE = '.crash-seen.json';
// Crashpad/Breakpad minidump extensions we treat as native crash evidence.
const MINIDUMP_EXT_RE = /\.(dmp|dump)$/i;

let logsDir: string | null = null;

function getLogsDir(): string {
  if (!logsDir) {
    logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function timestampForFilename(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

// Lazy-initialized path anonymizer — built once on first use after app is ready.
let _anonymizePaths: ((s: string) => string) | null = null;

function getAnonymizePaths(): (s: string) => string {
  if (!_anonymizePaths) {
    const pairs: Array<[string, string]> = [];
    // Most specific first. App install paths are nested (app.asar ⊂ resources ⊂ install
    // root), and stack traces reference them, so redact the deepest first. userData is
    // under home, so it must precede home too.
    try {
      pairs.push([app.getAppPath(), '<app>']);
    } catch {}
    try {
      if (process.resourcesPath) pairs.push([process.resourcesPath, '<resources>']);
    } catch {}
    try {
      pairs.push([path.dirname(process.execPath), '<appRoot>']);
    } catch {}
    try {
      pairs.push([app.getPath('userData'), '<userData>']);
    } catch {}
    try {
      pairs.push([os.tmpdir(), '<tmp>']);
    } catch {}
    try {
      pairs.push([app.getPath('temp'), '<tmp>']);
    } catch {}
    try {
      pairs.push([app.getPath('home'), '<home>']);
    } catch {}
    _anonymizePaths = buildPathAnonymizer(pairs);
  }
  return _anonymizePaths;
}

function createNewLogFile(dir: string, stream: LogStream): void {
  const filename = `${stream.prefix}-${timestampForFilename(new Date())}.jsonl`;
  stream.currentFile = path.join(dir, filename);
  stream.currentCount = 0;
}

function initCurrentLogFile(dir: string, stream: LogStream): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    createNewLogFile(dir, stream);
    return;
  }

  const candidates = entries
    .filter((e) => e.isFile() && !e.isSymbolicLink() && stream.re.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const name of candidates) {
    const filePath = path.join(dir, name);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const count = content.split('\n').filter((l) => l.trim().length > 0).length;
      if (count < MAX_RECORDS_PER_FILE) {
        stream.currentFile = filePath;
        stream.currentCount = count;
        return;
      }
    } catch {
      // skip unreadable file
    }
  }

  createNewLogFile(dir, stream);
}

function writeRecord(record: ErrorLogRecord, stream: LogStream): void {
  const dir = getLogsDir();
  if (stream.currentFile === null) {
    initCurrentLogFile(dir, stream);
  }
  if (stream.currentCount >= MAX_RECORDS_PER_FILE) {
    createNewLogFile(dir, stream);
  }
  fs.appendFileSync(stream.currentFile!, `${JSON.stringify(record)}${os.EOL}`, 'utf8');
  stream.currentCount += 1;
}

function toRecord(
  processType: 'main' | 'renderer',
  category: string,
  message: string,
  stack?: string,
  context?: unknown,
): ErrorLogRecord {
  const anonymize = getAnonymizePaths();
  return {
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    appName: app.getName(),
    platform: process.platform,
    arch: process.arch,
    processType,
    category,
    message: anonymize(message),
    stack: stack ? anonymize(stack) : undefined,
    context: context ? sanitizeContext(context, anonymize) : undefined,
  };
}

export function logMainError(
  category: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const record = toRecord(
    'main',
    category,
    err.message || 'Unknown main-process error',
    err.stack,
    context,
  );
  writeRecord(record, errorStream);
}

/** Log a crash (process gone, unresponsive window, native minidump) to the separate crash stream. */
export function logCrash(
  category: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const record = toRecord('main', category, err.message || 'Unknown crash', err.stack, context);
  writeRecord(record, crashStream);
}

function logRendererPayload(payload: RendererErrorPayload): void {
  const record = toRecord(
    'renderer',
    payload.category,
    payload.message,
    payload.stack,
    payload.context,
  );
  writeRecord(record, errorStream);
}

// --- Native minidump breadcrumb -------------------------------------------------------
// A native main-process crash kills the process before any JS handler runs, so the only
// artifact is the Crashpad minidump. On the next startup we scan the crashDumps directory
// and write a breadcrumb to the crash stream for any dump we have not recorded yet.

function findMinidumps(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && MINIDUMP_EXT_RE.test(entry.name)) {
        found.push(entry.name);
      }
    }
  };
  walk(dir, 0);
  return found;
}

function reportNewNativeCrashes(): void {
  let crashDumpsDir: string;
  try {
    crashDumpsDir = app.getPath('crashDumps');
  } catch {
    return; // crashReporter not started / path unavailable
  }

  const dumps = findMinidumps(crashDumpsDir);
  if (dumps.length === 0) return;

  const seenPath = path.join(getLogsDir(), CRASH_SEEN_FILE);
  let previousSeen: string[] = [];
  try {
    const raw = fs.readFileSync(seenPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      previousSeen = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // No marker yet, or unreadable — treat as nothing seen.
  }

  const { newDumps, updatedSeen } = diffSeenDumps(dumps, previousSeen);

  for (const name of newDumps) {
    try {
      logCrash('native_crash_detected', new Error(`Native crash minidump found: ${name}`), {
        dumpFile: name,
        crashDumpsDir,
      });
    } catch {
      // Never let logging a crash crash startup.
    }
  }

  try {
    fs.writeFileSync(seenPath, JSON.stringify(updatedSeen), 'utf8');
  } catch {
    // Best effort: if we can't persist, we may re-log the same dump next start.
  }
}

export function setupErrorLogging(): void {
  const dir = getLogsDir();
  const cleanup = cleanupOldLogsSafely(app.getPath('userData'), dir);
  if (cleanup.skippedReason) {
    console.warn(`[Diagnostics] Log cleanup skipped: ${cleanup.skippedReason}`);
  }

  // Breadcrumb for native crashes that happened in a previous session.
  reportNewNativeCrashes();

  process.on('uncaughtException', (error) => {
    try {
      logMainError('main_uncaught_exception', error);
    } catch {
      // Intentionally ignore to avoid recursive crashes.
    }
  });

  process.on('unhandledRejection', (reason) => {
    try {
      logMainError('main_unhandled_rejection', reason);
    } catch {
      // Intentionally ignore to avoid recursive crashes.
    }
  });

  // GPU / utility / pepper child-process crashes. These rarely white-screen the app, so
  // we only record them (no recovery here).
  app.on('child-process-gone', (_event, details) => {
    try {
      logCrash('child_process_gone', new Error(`Child process gone: ${details.reason}`), {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: (details as { name?: string }).name,
        serviceName: (details as { serviceName?: string }).serviceName,
      });
    } catch {
      // Intentionally ignore to avoid recursive crashes.
    }
  });

  ipcMain.handle('diagnostics:log-error', (_event, payload: RendererErrorPayload) => {
    try {
      logRendererPayload(payload);
      return { ok: true };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('diagnostics:get-logs-dir', () => {
    return getLogsDir();
  });

  ipcMain.handle('diagnostics:get-logs-path-hint', () => {
    return getLogsDir();
  });

  ipcMain.handle('diagnostics:open-logs-dir', async () => {
    console.info('[Diagnostics] IPC open logs dir request received');
    const result = await shell.openPath(getLogsDir());
    return { ok: !result, message: result || undefined };
  });
}
