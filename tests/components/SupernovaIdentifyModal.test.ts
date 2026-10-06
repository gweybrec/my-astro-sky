/**
 * Tests for SupernovaIdentifyModal.vue: the observation date pre-fills (UTC) and
 * triggers one TNS search on open; a photo without a date must have one entered
 * first; results inside the frame are listed (confirmed SNe pre-selected,
 * unclassified ATs flagged and opt-in) and pinned on the photo; "Add selected"
 * emits positioned POIs — the modal itself never persists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import SupernovaIdentifyModal from '../../src/components/modals/SupernovaIdentifyModal.vue';
import { computePhotoToProjMatrix } from '../../src/photo-placement';
import { photoPixelToRaDec } from '../../src/asteroid-identify';
import type { TnsCandidate } from '../../src/supernova-identify';
import type { Photo, ManualPlacement } from '../../src/types';
import { setCenterMode, setProjectionObserver } from '../../src/projection';

vi.mock('../../src/api', () => ({
  tnsConesearchAPI: vi.fn(),
  photoFileUrl: (fileName: string) => `/uploads/${fileName}`,
}));

import { tnsConesearchAPI } from '../../src/api';
const mockSearch = vi.mocked(tnsConesearchAPI);

const placement: ManualPlacement = {
  centerRa: 339.27,
  centerDec: 34.42,
  rotationDeg: 0,
  projPerPx: 0.00002,
  mirrorX: false,
  mirrorY: false,
};

function makePhoto(overrides?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1.jpg',
    width: 664,
    height: 470,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: [],
    manualPlacement: placement,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: '2026-09-04T20:02:11.000Z',
    notes: '',
    ...overrides,
  };
}

/** A candidate sitting at the given photo pixel. */
function candidateAt(
  photo: Photo,
  x: number,
  y: number,
  over: Partial<TnsCandidate>,
): TnsCandidate {
  const { ra, dec } = photoPixelToRaDec(computePhotoToProjMatrix(photo)!, x, y);
  return {
    name: 'SN 2026aaiv',
    raDeg: ra,
    decDeg: dec,
    type: 'SN Ia',
    classified: true,
    discoveryDate: '2026-09-01T11:23:32.352Z',
    discoveryMag: 17.325,
    hostName: 'NGC7331',
    redshift: 0.002722,
    tnsUrl: 'https://www.wis-tns.org/object/2026aaiv',
    ...over,
  };
}

function mountModal(photo: Photo) {
  return mount(SupernovaIdentifyModal, {
    props: { photo },
    global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] },
    attachTo: document.body,
  });
}

function stubImageRect(width: number, height: number) {
  const img = document.body.querySelector('img') as HTMLImageElement;
  img.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {},
  })) as never;
  img.dispatchEvent(new Event('load'));
}

const buttons = () => [...document.body.querySelectorAll('button')];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim().startsWith(text));

beforeEach(() => {
  mockSearch.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SupernovaIdentifyModal', () => {
  it('pre-fills the UTC observation date and searches the photo field on open', async () => {
    const photo = makePhoto();
    mockSearch.mockResolvedValue([]);
    const wrapper = mountModal(photo);
    await flushPromises();

    expect((document.body.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      '2026-09-04',
    );
    expect((document.body.querySelector('input[type="time"]') as HTMLInputElement).value).toBe(
      '20:02',
    );
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const params = mockSearch.mock.calls[0][0];
    expect(params.raDeg).toBeCloseTo(339.27, 2);
    expect(params.decDeg).toBeCloseTo(34.42, 2);
    expect(params.dateStart).toBe('2025-09-04');
    expect(params.dateEnd).toBe('2026-11-03');
    expect(document.body.textContent).toContain('No known supernova');
    wrapper.unmount();
  });

  it('requires a date when the photo has none, then searches', async () => {
    const wrapper = mountModal(makePhoto({ observationDate: null }));
    await flushPromises();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('This photo has no observation date');
    expect(byText('Search')!.disabled).toBe(true);

    mockSearch.mockResolvedValue([]);
    const date = document.body.querySelector('input[type="date"]') as HTMLInputElement;
    date.value = '2025-10-15';
    date.dispatchEvent(new Event('input'));
    const time = document.body.querySelector('input[type="time"]') as HTMLInputElement;
    time.value = '21:30';
    time.dispatchEvent(new Event('input'));
    await flushPromises();
    // Editing the date and then the time never searches by itself (TNS rate limit).
    expect(mockSearch).not.toHaveBeenCalled();
    expect(byText('Search')!.disabled).toBe(false);
    byText('Search')!.click();
    await flushPromises();
    expect(mockSearch.mock.calls[0][0].dateStart).toBe('2024-10-15');
    wrapper.unmount();
  });

  it('lists in-frame candidates, pre-selects confirmed SNe, flags ATs and pins them', async () => {
    const photo = makePhoto();
    mockSearch.mockResolvedValue([
      candidateAt(photo, 300, 260, {}),
      candidateAt(photo, 100, 100, {
        name: 'AT 2026acui',
        type: null,
        classified: false,
        tnsUrl: 'https://www.wis-tns.org/object/2026acui',
      }),
      candidateAt(photo, 5000, 5000, { name: 'SN outside' }),
    ]);
    const wrapper = mountModal(photo);
    await flushPromises();
    stubImageRect(664, 470);
    await flushPromises();

    const text = document.body.textContent ?? '';
    expect(text).toContain('SN 2026aaiv');
    expect(text).toContain('AT 2026acui');
    expect(text).not.toContain('SN outside');
    expect(text).toContain('Unconfirmed');
    expect(text).toContain('3 d after discovery');

    const checks = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map((c) => c.checked)).toEqual([true, false]);

    // One starburst pin per candidate, at its pixel position (1:1 display).
    const pins = [
      ...document.body.querySelectorAll<HTMLElement>('.modal-photo-container span svg'),
    ];
    expect(pins).toHaveLength(2);
    const pin = pins[0].parentElement!;
    expect(parseFloat(pin.style.left)).toBeCloseTo(300, 0);
    expect(parseFloat(pin.style.top)).toBeCloseTo(260, 0);
    wrapper.unmount();
  });

  it('emits the selected candidates as positioned supernova POIs', async () => {
    const photo = makePhoto();
    const sn = candidateAt(photo, 300, 260, {});
    const at = candidateAt(photo, 100, 100, { name: 'AT 2026acui', classified: false, type: null });
    mockSearch.mockResolvedValue([sn, at]);
    const wrapper = mountModal(photo);
    await flushPromises();

    const checks = document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checks[1].checked = true;
    checks[1].dispatchEvent(new Event('change'));
    await flushPromises();

    byText('Add selected (2)')!.click();
    const emitted = wrapper.emitted('identified')!;
    expect(emitted).toHaveLength(1);
    const [emittedPhoto, pois] = emitted[0] as [Photo, unknown[]];
    expect(emittedPhoto.id).toBe('p1');
    expect(pois).toEqual([
      { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: sn.raDeg, dec: sn.decDeg },
      { name: 'AT 2026acui', categoryId: 'cat-supernova', ra: at.raDeg, dec: at.decDeg },
    ]);
    wrapper.unmount();
  });

  it('shows the server error (e.g. TNS rate limit) instead of results', async () => {
    mockSearch.mockRejectedValue(new Error('The TNS server is rate-limiting searches'));
    const wrapper = mountModal(makePhoto());
    await flushPromises();
    expect(document.body.textContent).toContain('rate-limiting');
    expect(byText('Add selected')!.disabled).toBe(true);
    wrapper.unmount();
  });

  it('searches and pins the same way while the zenith-centred sky map has the field below the horizon', async () => {
    const photo = makePhoto();
    const sn = candidateAt(photo, 300, 260, {});
    const run = async () => {
      mockSearch.mockReset();
      mockSearch.mockResolvedValue([sn]);
      const wrapper = mountModal(photo);
      await flushPromises();
      stubImageRect(664, 470);
      await flushPromises();
      const pin = document.body.querySelector<HTMLElement>(
        '.modal-photo-container span svg',
      )?.parentElement;
      const result = {
        params: mockSearch.mock.calls[0][0],
        left: pin ? parseFloat(pin.style.left) : NaN,
        top: pin ? parseFloat(pin.style.top) : NaN,
      };
      wrapper.unmount();
      document.body.innerHTML = '';
      return result;
    };

    const pole = await run();
    setCenterMode('zenith');
    // NGC 7331 (RA 22h37m) at LST 10.6h from 48°N: ~12 h from the meridian.
    setProjectionObserver(10.6, 48);
    try {
      const zenith = await run();
      expect(zenith.params.raDeg).toBeCloseTo(pole.params.raDeg, 9);
      expect(zenith.params.decDeg).toBeCloseTo(pole.params.decDeg, 9);
      expect(zenith.params.radiusArcmin).toBeCloseTo(pole.params.radiusArcmin, 9);
      expect(zenith.left).toBeCloseTo(300, 0);
      expect(zenith.top).toBeCloseTo(260, 0);
    } finally {
      setCenterMode('pole');
    }
  });
});
