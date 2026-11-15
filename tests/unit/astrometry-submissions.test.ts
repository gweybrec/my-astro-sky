import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAstrometrySubmissions = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  listAstrometrySubmissions: (...args: unknown[]) => listAstrometrySubmissions(...args),
}));

const {
  SUBMISSIONS_PAGE_SIZE,
  clearSubmissionPages,
  isSubmissionsRateLimited,
  loadSubmissionPage,
} = await import('@myastrosky/app-state/astrometry-submissions');

const page = (ids: number[], total = 12) => ({
  submissions: ids.map((jobId) => ({ submissionId: jobId, jobId, status: 'success' })),
  total,
});
const refused = () =>
  Object.assign(new Error('too many requests'), { code: 'ASTROMETRY_RATE_LIMITED' });

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clearSubmissionPages();
  listAstrometrySubmissions.mockReset();
  clock = 1_000_000;
});

describe('loadSubmissionPage', () => {
  it('asks for five submissions at the given position', async () => {
    listAstrometrySubmissions.mockResolvedValue(page([7, 6, 5, 4, 3]));
    const r = await loadSubmissionPage(5, false, now);
    expect(listAstrometrySubmissions).toHaveBeenCalledWith(5, SUBMISSIONS_PAGE_SIZE);
    expect(SUBMISSIONS_PAGE_SIZE).toBe(5);
    expect(r).toEqual({ page: page([7, 6, 5, 4, 3]), rateLimited: false });
  });

  it('shows a page loaded less than two minutes ago again without a request', async () => {
    listAstrometrySubmissions.mockResolvedValue(page([1]));
    await loadSubmissionPage(0, false, now);
    clock += 119_000;
    await loadSubmissionPage(0, false, now);
    expect(listAstrometrySubmissions).toHaveBeenCalledTimes(1);
    clock += 2_000;
    await loadSubmissionPage(0, false, now);
    expect(listAstrometrySubmissions).toHaveBeenCalledTimes(2);
  });

  it('always asks again on a refresh, which forgets the other pages', async () => {
    listAstrometrySubmissions.mockResolvedValue(page([1]));
    await loadSubmissionPage(0, false, now);
    await loadSubmissionPage(5, false, now);
    await loadSubmissionPage(0, true, now);
    expect(listAstrometrySubmissions).toHaveBeenCalledTimes(3);
    await loadSubmissionPage(5, false, now);
    expect(listAstrometrySubmissions).toHaveBeenCalledTimes(4);
  });

  it('returns the page loaded before when astrometry.net refuses, and throws without one', async () => {
    listAstrometrySubmissions.mockResolvedValueOnce(page([9, 8]));
    await loadSubmissionPage(0, false, now);
    listAstrometrySubmissions.mockRejectedValue(refused());
    expect(await loadSubmissionPage(0, true, now)).toEqual({
      page: page([9, 8]),
      rateLimited: true,
    });
    const err = await loadSubmissionPage(5, false, now).catch((e) => e);
    expect(isSubmissionsRateLimited(err)).toBe(true);
  });

  it('keeps a known page when an answer comes back empty', async () => {
    listAstrometrySubmissions.mockResolvedValueOnce(page([9]));
    await loadSubmissionPage(0, false, now);
    listAstrometrySubmissions.mockResolvedValueOnce(page([], 0));
    expect((await loadSubmissionPage(0, true, now)).page).toEqual(page([9]));
  });

  it('throws any other error', async () => {
    listAstrometrySubmissions.mockRejectedValue(new Error('offline'));
    const err = await loadSubmissionPage(0, false, now).catch((e) => e);
    expect(err.message).toBe('offline');
    expect(isSubmissionsRateLimited(err)).toBe(false);
  });
});
