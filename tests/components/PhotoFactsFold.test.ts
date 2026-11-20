import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { setLang } from '@myastrosky/core/i18n/index';
import PhotoFactsFold from '../../src/components/panels/PhotoFactsFold.vue';
import type { Photo } from '@myastrosky/core/types';

const getGearSetups = vi.hoisted(() => vi.fn(async () => [{ id: 'setup-b', name: 'Seestar S50' }]));
vi.mock('../../src/api', () => ({ getGearSetups: () => getGearSetups() }));

function makePhoto(over: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M42.jpg',
    width: 100,
    height: 100,
    createdAt: '2025-10-12T00:00:00Z',
    correspondences: [],
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    notes: '',
    ...over,
  };
}

const fullPhoto = makePhoto({
  gearSetupId: 'setup-b',
  observationDate: '2025-10-12T21:30:00Z',
  integrations: [{ filter: 'Ha', frames: 30, seconds: 120 }],
  captureDetails: { gain: 80 },
});

describe('PhotoFactsFold', () => {
  beforeEach(() => {
    setLang('en');
    localStorage.clear();
  });

  it('shows nothing for a photo with no facts', () => {
    const w = mount(PhotoFactsFold, { props: { photo: makePhoto() } });
    expect(w.find('[data-test="photo-facts"]').exists()).toBe(false);
  });

  it('shows the summary line folded, with the equipment name looked up', async () => {
    const w = mount(PhotoFactsFold, { props: { photo: fullPhoto } });
    await flushPromises();
    expect(
      w.findAll('[data-test="photo-facts-summary-part"]').map((p) => p.text().replace(/\s/g, ' ')),
    ).toEqual(['Seestar S50 ·', '1h00 ·', 'Oct 12, 2025']);
    // Only the equipment name may break across lines.
    expect(
      w
        .findAll('[data-test="photo-facts-summary-part"]')
        .map((p) => p.classes('whitespace-nowrap')),
    ).toEqual([false, true, true]);
    expect(w.get('[data-test="photo-facts-list"]').attributes('style')).toContain('display: none');
  });

  it('unfolds into the facts and remembers it', async () => {
    const w = mount(PhotoFactsFold, { props: { photo: fullPhoto } });
    await flushPromises();
    await w.get('[data-test="photo-facts-toggle"]').trigger('click');
    const list = w.get('[data-test="photo-facts-list"]');
    expect(list.attributes('style') ?? '').not.toContain('display: none');
    expect(w.get('[data-test="photo-facts-wide"]').text()).toContain('Seestar S50');
    expect(w.findAll('[data-test="photo-facts-exposure"]').map((r) => r.text())).toEqual([
      '30 × 120 sHa',
    ]);
    expect(list.text()).toContain('80');

    const again = mount(PhotoFactsFold, { props: { photo: fullPhoto } });
    expect(again.get('[data-test="photo-facts-list"]').attributes('style') ?? '').not.toContain(
      'display: none',
    );
  });

  it('shows nothing when the only facts are the labels, already chips in the card', () => {
    const w = mount(PhotoFactsFold, { props: { photo: makePhoto({ labels: ['vespera'] }) } });
    expect(w.find('[data-test="photo-facts"]').exists()).toBe(false);
  });

  it('offers "Show details" when only details beyond the summary are known', () => {
    const w = mount(PhotoFactsFold, {
      props: { photo: makePhoto({ captureDetails: { gain: 80 } }) },
    });
    expect(w.get('[data-test="photo-facts-summary"]').text()).toBe('Show details');
  });
});
