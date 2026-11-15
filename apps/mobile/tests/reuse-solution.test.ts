import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ionicStubs } from './helpers';

const listAstrometrySubmissions = vi.fn();
vi.mock('@myastrosky/app-state/api', () => ({
  listAstrometrySubmissions: (...a: unknown[]) => listAstrometrySubmissions(...a),
}));
vi.mock('@myastrosky/core/platform/error-hook', () => ({ reportError: vi.fn() }));
const reusePendingSolution = vi.fn();
vi.mock('../src/pending-solve', () => ({
  reusePendingSolution: (...a: unknown[]) => reusePendingSolution(...a),
}));
const showWarning = vi.fn();
const showError = vi.fn();
vi.mock('../src/composables/useErrorToast', () => ({
  useErrorToast: () => ({ showWarning, showError }),
}));
const back = vi.fn();
const replace = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'pending-1' } }),
  useRouter: () => ({ back, replace }),
}));

import { clearSubmissionPages } from '@myastrosky/app-state/astrometry-submissions';
import ReuseSolutionPage from '../src/pages/ReuseSolutionPage.vue';

enableAutoUnmount(afterEach);
const mountPage = () => mount(ReuseSolutionPage, { global: { stubs: ionicStubs } });

const sub = (jobId: number, status = 'success', size = true) => ({
  submissionId: jobId,
  jobId,
  status,
  filename: `photo-${jobId}.fit`,
  ...(size ? { width: 1354, height: 1018 } : {}),
});
const page = (ids: number[], total = 12) => ({ submissions: ids.map((id) => sub(id)), total });
const refused = () =>
  Object.assign(new Error("Astrometry.net refuse pour l'instant : trop de requêtes."), {
    code: 'ASTROMETRY_RATE_LIMITED',
  });
const titles = (w: ReturnType<typeof mountPage>) =>
  w.findAll('.mob-row .mob-row-title').map((t) => t.text());

describe('the page that reuses an astrometry.net solution', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    clearSubmissionPages();
    vi.clearAllMocks();
    listAstrometrySubmissions.mockReset();
  });

  it('lists the five most recent submissions with their job, size and state', async () => {
    listAstrometrySubmissions.mockResolvedValue({
      submissions: [
        sub(100),
        sub(99, 'solving', false),
        sub(98, 'failure', false),
        sub(97),
        sub(96),
      ],
      total: 12,
    });
    const w = mountPage();
    await flushPromises();
    expect(listAstrometrySubmissions).toHaveBeenCalledWith(0, 5);
    expect(w.text()).toContain('Réutiliser une solution astrometry.net');
    expect(w.text()).toContain('12 soumissions sur votre compte.');
    expect(titles(w)).toEqual([
      'photo-100.fit',
      'photo-99.fit',
      'photo-98.fit',
      'photo-97.fit',
      'photo-96.fit',
    ]);
    const rows = w.findAll('.mob-row');
    expect(rows[0].text()).toContain('Job 100 · 1354 × 1018 px');
    expect(rows[0].find('.mob-status--success').text()).toBe('✓ Résolue');
    expect(rows[1].find('.mob-status--warn').text()).toBe('En cours');
    expect(rows[2].find('.mob-status--danger').text()).toBe('Échouée');
    // Only a solved submission can be chosen.
    expect(rows[1].classes()).toContain('mob-row--disabled');
    expect(rows[2].classes()).toContain('mob-row--disabled');
    expect(w.text()).toContain('Voir les 5 suivantes');
  });

  it('adds the next ones under those shown, and says how many are left', async () => {
    listAstrometrySubmissions
      .mockResolvedValueOnce(page([12, 11, 10, 9, 8]))
      .mockResolvedValueOnce(page([7, 6, 5, 4, 3]))
      .mockResolvedValueOnce(page([2, 1]));
    const w = mountPage();
    await flushPromises();
    await w.findComponent({ name: 'PhoneButton' }).trigger('click');
    await flushPromises();
    expect(listAstrometrySubmissions).toHaveBeenLastCalledWith(5, 5);
    expect(titles(w)).toHaveLength(10);
    expect(w.text()).toContain('Voir les 2 suivantes');
    await w.findComponent({ name: 'PhoneButton' }).trigger('click');
    await flushPromises();
    expect(titles(w)).toHaveLength(12);
    expect(w.findComponent({ name: 'PhoneButton' }).exists()).toBe(false);
  });

  it('places the waiting photo with a solved submission and goes back', async () => {
    listAstrometrySubmissions.mockResolvedValue(page([17323748]));
    const w = mountPage();
    await flushPromises();
    window.history.replaceState({ back: '/tabs/gallery' }, '');
    await w.find('.mob-row').trigger('click');
    expect(reusePendingSolution).toHaveBeenCalledWith('pending-1', 17323748);
    expect(back).toHaveBeenCalled();
  });

  it('keeps the list shown when a refresh is refused, with the warning toast', async () => {
    listAstrometrySubmissions.mockResolvedValueOnce(page([5, 4, 3, 2, 1]));
    const w = mountPage();
    await flushPromises();
    listAstrometrySubmissions.mockRejectedValue(refused());
    await w.find('button[aria-label="Rafraîchir la liste"]').trigger('click');
    await flushPromises();
    expect(titles(w)).toHaveLength(5);
    expect(showWarning).toHaveBeenCalledWith(
      'Astrometry.net refuse pour l’instant : trop de requêtes. La liste affichée est la dernière chargée, réessayez plus tard.'.replace(
        '’',
        "'",
      ),
    );
  });

  it('says why when nothing could be loaded, or when the account has no submission', async () => {
    listAstrometrySubmissions.mockRejectedValue(refused());
    const w = mountPage();
    await flushPromises();
    expect(w.find('.mob-empty-text').text()).toBe(
      "Astrometry.net refuse pour l'instant : trop de requêtes.",
    );
    expect(w.findAll('.mob-row')).toHaveLength(0);

    listAstrometrySubmissions.mockResolvedValue({ submissions: [], total: 0 });
    await w.find('button[aria-label="Rafraîchir la liste"]').trigger('click');
    await flushPromises();
    expect(w.find('.mob-empty-text').text()).toBe(
      'Aucune soumission trouvée sur votre compte astrometry.net.',
    );
  });
});
