// Pure mapping for the in-app update check, kept out of the Express handler so
// it can be unit-tested without standing up a server or mocking the network.

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
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
