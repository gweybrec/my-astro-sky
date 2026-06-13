// Pure dedup logic for native crash minidumps.
//
// Crashpad writes minidumps to disk when a native crash kills the process before any
// JS handler can run. On the next startup we scan for dump files and want to log a
// breadcrumb for any we have not already recorded. This helper computes that diff and
// the updated "seen" set to persist back to the marker file.

export interface CrashSeenResult {
  /** Dump basenames present now but not previously seen — log a breadcrumb for these. */
  newDumps: string[];
  /** The set to persist: previously-seen names that still exist, plus the new ones. */
  updatedSeen: string[];
}

/**
 * @param currentDumps dump basenames found on disk now
 * @param previousSeen dump basenames recorded on a prior run
 */
export function diffSeenDumps(currentDumps: string[], previousSeen: string[]): CrashSeenResult {
  const current = new Set(currentDumps);
  const seen = new Set(previousSeen);

  const newDumps = currentDumps.filter((name) => !seen.has(name));

  // Drop names for dumps that no longer exist so the marker file does not grow forever.
  const updatedSeen = [...current];

  return { newDumps, updatedSeen };
}
