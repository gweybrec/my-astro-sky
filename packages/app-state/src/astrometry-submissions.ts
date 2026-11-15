/**
 * The pages of the account's astrometry.net submissions, as the desktop's list and the phone's page show them: five at
 * a time, each page asking astrometry.net for the details of its own submissions only. A page loaded less than two
 * minutes ago is shown again without a request; a page loaded before is kept to be shown when astrometry.net refuses
 * for too many requests.
 */
import { listAstrometrySubmissions, type AstrometrySubmissionPage } from './api';

/** Submissions per page. */
export const SUBMISSIONS_PAGE_SIZE = 5;
const CACHE_TTL_MS = 2 * 60 * 1000;

/** The pages loaded, by their first position. */
const pages = new Map<number, { at: number; page: AstrometrySubmissionPage }>();

/** The error of `loadSubmissionPage` when astrometry.net refused for too many requests. */
export const isSubmissionsRateLimited = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === 'ASTROMETRY_RATE_LIMITED';

/**
 * The page that starts at `offset`: the one loaded less than two minutes ago, else a new request (always one with
 * `forceRefresh`, which also forgets the other pages: a refresh can shift them all). When astrometry.net refuses for
 * too many requests, the page loaded before is returned with `rateLimited`; without one, the error is thrown (its
 * message is translated, see `isSubmissionsRateLimited`).
 */
export async function loadSubmissionPage(
  offset: number,
  forceRefresh = false,
  now: () => number = Date.now,
): Promise<{ page: AstrometrySubmissionPage; rateLimited: boolean }> {
  const cached = pages.get(offset);
  if (!forceRefresh && cached && now() - cached.at < CACHE_TTL_MS) {
    return { page: cached.page, rateLimited: false };
  }
  try {
    const page = await listAstrometrySubmissions(offset, SUBMISSIONS_PAGE_SIZE);
    // An empty answer from a transient API issue keeps the page known.
    if (page.submissions.length === 0 && cached && cached.page.submissions.length > 0) {
      return { page: cached.page, rateLimited: false };
    }
    if (forceRefresh) pages.clear();
    pages.set(offset, { at: now(), page });
    return { page, rateLimited: false };
  } catch (err) {
    if (isSubmissionsRateLimited(err) && cached) return { page: cached.page, rateLimited: true };
    throw err;
  }
}

/** Forgets every page (tests). */
export function clearSubmissionPages(): void {
  pages.clear();
}
