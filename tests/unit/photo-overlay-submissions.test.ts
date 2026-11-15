import { describe, it, expect, vi } from 'vitest';

const listAstrometrySubmissions = vi.fn();
vi.mock('@myastrosky/app-state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myastrosky/app-state/api')>()),
  listAstrometrySubmissions: (...a: unknown[]) => listAstrometrySubmissions(...a),
}));

import { PhotoOverlay } from '../../src/photo-overlay';

const sub = (jobId: number, status: string) => ({
  submissionId: jobId,
  jobId,
  status,
  filename: `job${jobId}.fit`,
});

describe('the astrometry.net solution list', () => {
  it('shows each job state in the language of the app, not the raw status astrometry.net returns', async () => {
    localStorage.setItem('lang', 'fr');
    listAstrometrySubmissions.mockResolvedValue({
      submissions: [sub(3, 'success'), sub(2, 'failure'), sub(1, 'solving')],
      total: 3,
    });
    const overlay = new PhotoOverlay(document.createElement('div'), () => ({}) as any, {
      setOnViewChange: vi.fn(),
    } as any);
    void overlay.showSubmissionSelectionDialog();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.submission-status-badge')).toHaveLength(3),
    );
    const badges = [...document.querySelectorAll('.submission-status-badge')].map(
      (b) => b.textContent,
    );
    expect(badges).toEqual(['✓ Résolue', 'Échouée', 'En cours']);
  });
});
