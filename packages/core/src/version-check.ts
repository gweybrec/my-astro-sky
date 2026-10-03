// Pure semver comparison helpers for the in-app update check.
// No DOM, no network — kept isolated so it can be unit-tested deterministically.

/** localStorage key holding the version the user has already been notified about. */
export const DISMISSED_UPDATE_KEY = 'myAstroSky.dismissedUpdateVersion';

/**
 * Parse a version string into its numeric `[major, minor, patch]` segments.
 * Tolerates a leading `v` (GitHub tags) and any pre-release/build suffix
 * (e.g. `1.2.3-beta.1` → `[1, 2, 3]`). Returns `null` when no numeric
 * segments can be parsed.
 */
export function parseVersion(value: string): number[] | null {
  if (typeof value !== 'string') return null;
  // Drop a leading "v" and anything from the first "-" or "+" (pre-release/build metadata).
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (!core) return null;
  const segments = core.split('.').map((s) => Number.parseInt(s, 10));
  if (segments.length === 0 || segments.some((n) => Number.isNaN(n))) return null;
  return segments;
}

/**
 * Compare two version strings. Returns a negative number when `a < b`,
 * positive when `a > b`, and `0` when they are equal. Unparseable inputs
 * are treated as `0` so they never spuriously signal an update.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * True when `latest` is a strictly newer version than `current`.
 * Invalid inputs (either side unparseable) yield `false` so a malformed
 * GitHub tag never produces a false "update available" prompt.
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  if (parseVersion(current) === null || parseVersion(latest) === null) return false;
  return compareVersions(latest, current) > 0;
}
