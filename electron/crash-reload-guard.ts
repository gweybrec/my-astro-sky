// Pure decision logic for whether to auto-reload the window after a renderer crash.
//
// A renderer that crashes immediately on load would otherwise reload forever. This
// helper bounds recovery: given the timestamps of recent crashes, it allows reloads
// up to `maxReloads` within a rolling `windowMs` window, then gives up so the caller
// can surface a dialog instead of looping.

export interface ReloadGuardOptions {
  maxReloads: number;
  windowMs: number;
}

export const DEFAULT_RELOAD_GUARD: ReloadGuardOptions = {
  maxReloads: 3,
  windowMs: 60_000,
};

export interface ReloadDecision {
  /** Whether the window should be reloaded now. */
  reload: boolean;
  /** Crash timestamps still within the window (caller persists this for the next crash). */
  recentCrashes: number[];
}

/**
 * Decide whether to reload after a renderer crash.
 *
 * @param previousCrashes timestamps (ms) of prior crashes that triggered a reload
 * @param now timestamp (ms) of the crash just observed
 */
export function shouldReloadAfterCrash(
  previousCrashes: number[],
  now: number,
  options: ReloadGuardOptions = DEFAULT_RELOAD_GUARD,
): ReloadDecision {
  const { maxReloads, windowMs } = options;
  const cutoff = now - windowMs;
  // Keep only crashes inside the rolling window, plus the one we just saw.
  const recentCrashes = [...previousCrashes.filter((t) => t > cutoff), now];
  // Allow the reload as long as the number of crashes in the window does not exceed
  // the budget. The Nth crash (== maxReloads) still reloads; the (N+1)th gives up.
  const reload = recentCrashes.length <= maxReloads;
  return { reload, recentCrashes };
}
