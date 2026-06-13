import fs from 'fs';
import path from 'path';

const DEFAULT_RETENTION_DAYS = 30;
const LOG_FILENAME_RE = /^my-astro-sky-error-\d{8}-\d{6}-\d{3}-[a-f0-9]{6}\.json$/;
const LOG_FILENAME_BATCH_RE = /^my-astro-sky-errors-\d{8}-\d{6}-\d{3}\.jsonl$/;
const LOG_FILENAME_CRASH_RE = /^my-astro-sky-crash-\d{8}-\d{6}-\d{3}\.jsonl$/;

export interface CleanupResult {
  deletedCount: number;
  skippedReason?: string;
}

function isWithin(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveRealPathSafe(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export function cleanupOldLogsSafely(
  userDataDir: string,
  logsDir: string,
  nowMs = Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
): CleanupResult {
  const userDataReal = resolveRealPathSafe(userDataDir);
  const logsReal = resolveRealPathSafe(logsDir);
  if (!userDataReal || !logsReal) {
    return { deletedCount: 0, skippedReason: 'path_not_resolved' };
  }

  let logsDirLStat: fs.Stats;
  try {
    logsDirLStat = fs.lstatSync(logsDir);
  } catch {
    return { deletedCount: 0, skippedReason: 'logs_dir_not_accessible' };
  }

  if (logsDirLStat.isSymbolicLink()) {
    return { deletedCount: 0, skippedReason: 'logs_dir_is_symlink' };
  }
  if (!logsDirLStat.isDirectory()) {
    return { deletedCount: 0, skippedReason: 'logs_dir_not_directory' };
  }

  if (!isWithin(userDataReal, logsReal)) {
    return { deletedCount: 0, skippedReason: 'logs_dir_outside_userdata' };
  }

  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return { deletedCount: 0, skippedReason: 'readdir_failed' };
  }

  let deletedCount = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) continue;
    if (!entry.isFile()) continue;
    if (
      !LOG_FILENAME_RE.test(entry.name) &&
      !LOG_FILENAME_BATCH_RE.test(entry.name) &&
      !LOG_FILENAME_CRASH_RE.test(entry.name)
    ) continue;

    const candidatePath = path.join(logsDir, entry.name);

    let candidateLStat: fs.Stats;
    try {
      candidateLStat = fs.lstatSync(candidatePath);
    } catch {
      continue;
    }
    if (!candidateLStat.isFile() || candidateLStat.isSymbolicLink()) continue;

    const candidateReal = resolveRealPathSafe(candidatePath);
    if (!candidateReal) continue;
    if (!isWithin(logsReal, candidateReal)) continue;

    if (candidateLStat.mtimeMs < cutoff) {
      try {
        fs.unlinkSync(candidatePath);
        deletedCount += 1;
      } catch {
        // Best effort: ignore individual deletion failures.
      }
    }
  }

  return { deletedCount };
}
