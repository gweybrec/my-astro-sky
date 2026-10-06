/**
 * The in-app update check: the latest published release of the project on GitHub, fetched through
 * the `HttpClient` port. The answer (or its absence) is cached for an hour in the service instance,
 * dated by `now`.
 */
import type { LatestRelease } from '../domain/settings';
import type { HttpClient } from '../ports/http-client';

export type { LatestRelease };

// GitHub repository that publishes releases, used by the in-app update check.
const GITHUB_RELEASES_REPO = 'gweybrec/my-astro-sky';
const LATEST_RELEASE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface VersionServiceDeps {
  http: HttpClient;
  /** The clock, in milliseconds since the epoch; it dates the cache. */
  now: () => number;
}

export interface VersionService {
  /**
   * The latest published release, or `null` when there is none or GitHub cannot be reached (the update
   * check fails silently). Never throws. Cached for one hour, a failure included, so GitHub is not
   * hit repeatedly while offline.
   */
  getLatest(): Promise<LatestRelease | null>;
}

/**
 * Map a GitHub "latest release" API payload to our {@link LatestRelease} shape.
 * Returns `null` when the payload is missing a usable `tag_name` (e.g. the repo
 * has no releases yet, or the response is malformed) so the update check shows
 * nothing rather than surfacing an error.
 */
export function parseLatestRelease(data: unknown): LatestRelease | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
  if (typeof d.tag_name !== 'string' || d.tag_name.trim() === '') return null;
  return {
    version: d.tag_name,
    url: typeof d.html_url === 'string' ? d.html_url : '',
    publishedAt: typeof d.published_at === 'string' ? d.published_at : null,
  };
}

export function createVersionService(deps: VersionServiceDeps): VersionService {
  const { http, now } = deps;
  let cache: { value: LatestRelease | null; fetchedAt: number } | null = null;

  return {
    async getLatest() {
      const at = now();
      if (cache && at - cache.fetchedAt < LATEST_RELEASE_TTL_MS) return cache.value;

      try {
        const response = await http({
          method: 'GET',
          url: `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases/latest`,
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MyAstroSky' },
        });
        if (response.status < 200 || response.status > 299) {
          throw new Error(`GitHub responded ${response.status}`);
        }
        const value = parseLatestRelease(JSON.parse(await response.text()));
        cache = { value, fetchedAt: at };
        return value;
      } catch (err) {
        // Network error, rate limit, or no releases yet: fail silently with null so the update check
        // never disrupts startup. Being offline is an expected condition, so warn rather than error.
        console.warn('[VersionCheck] Could not fetch latest release', err);
        cache = { value: null, fetchedAt: at };
        return null;
      }
    },
  };
}
