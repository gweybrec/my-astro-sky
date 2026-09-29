/**
 * Tests for CometIdentifyModal.vue: one search runs on open when the photo has a
 * date; editing the (UTC) date/time does nothing until Search is clicked; comets in
 * the frame are listed, pre-selected and pinned; comets just outside it are listed as
 * "nearby" (a wrong date diagnosis); clicking the photo moves the active comet's
 * pin, and "Add selected" emits positioned comet POIs — the modal never persists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import CometIdentifyModal from '../../src/components/modals/CometIdentifyModal.vue';
import { computePhotoToProjMatrix } from '../../src/photo-placement';
import { photoPixelToRaDec } from '../../src/asteroid-identify';
import { cometRaDec } from '../../src/comet-ephemeris';
import { dateToJD } from '../../src/astro-time';
import { parseCometEls } from '../../server/comets';
import { setCenterMode, setProjectionObserver } from '../../src/projection';
import type { Photo, ManualPlacement } from '../../src/types';

vi.mock('../../src/api', () => ({
  cometElementsAPI: vi.fn(),
}));

import { cometElementsAPI } from '../../src/api';
const mockElements = vi.mocked(cometElementsAPI);

const COMETS = parseCometEls(
  readFileSync(join(__dirname, '../fixtures/comets/CometEls-sample.txt'), 'utf-8'),
);
const OBS = '2025-11-07T18:42:00.000Z';
const W = 664;
const H = 470;

// Frame centred exactly on the predicted position of C/2025 R2 at OBS.
const r2At = cometRaDec(
  COMETS.find((c) => c.designation === 'C/2025 R2')!,
  dateToJD(new Date(OBS)),
);
const placement: ManualPlacement = {
  centerRa: r2At.raDeg,
  centerDec: r2At.decDeg,
  rotationDeg: 0,
  projPerPx: 0.00002,
  mirrorX: false,
  mirrorY: false,
};

function makePhoto(overrides?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'C/2025 R2 Swan',
    width: W,
    height: H,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: [],
    manualPlacement: placement,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: OBS,
    notes: '',
    ...overrides,
  };
}

function mountModal(photo: Photo) {
  return mount(CometIdentifyModal, {
    props: { photo },
    global: { plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })] },
    attachTo: document.body,
  });
}

function stubImageRect() {
  const img = document.body.querySelector('img') as HTMLImageElement;
  img.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: W,
    height: H,
    right: W,
    bottom: H,
    x: 0,
    y: 0,
    toJSON() {},
  })) as never;
  img.dispatchEvent(new Event('load'));
}

const buttons = () => [...document.body.querySelectorAll('button')];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim().startsWith(text));
const pins = () =>
  [...document.body.querySelectorAll<HTMLElement>('.modal-photo-container span svg')].map(
    (svg) => svg.parentElement!,
  );

async function setDate(value: string) {
  const date = document.body.querySelector('input[type="date"]') as HTMLInputElement;
  date.value = value;
  date.dispatchEvent(new Event('input'));
  await flushPromises();
}

beforeEach(() => {
  mockElements.mockReset();
  mockElements.mockResolvedValue(COMETS);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CometIdentifyModal', () => {
  it('pre-fills the UTC date, lists the comet in frame pre-selected, and pins it', async () => {
    const wrapper = mountModal(makePhoto());
    await flushPromises();
    stubImageRect();
    await flushPromises();

    expect((document.body.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      '2025-11-07',
    );
    expect((document.body.querySelector('input[type="time"]') as HTMLInputElement).value).toBe(
      '18:42',
    );
    // One search ran on open (the photo has a date).
    expect(mockElements).toHaveBeenCalledTimes(1);
    expect(byText('Search')!.disabled).toBe(false);

    const text = document.body.textContent ?? '';
    expect(text).toContain('C/2025 R2 (SWAN)');
    expect(text).toContain('View on JPL');
    const checks = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map((c) => c.checked)).toEqual([true]);

    expect(pins()).toHaveLength(1);
    expect(parseFloat(pins()[0].style.left)).toBeCloseTo(W / 2, -1);
    expect(parseFloat(pins()[0].style.top)).toBeCloseTo(H / 2, -1);
    wrapper.unmount();
  });

  it('keeps the results until Search is clicked, then a day off moves the comet to "nearby"', async () => {
    const wrapper = mountModal(makePhoto());
    await flushPromises();
    await setDate('2025-11-08');
    // Editing the date alone changes nothing: no request, same results.
    expect(mockElements).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Near this field');
    expect(byText('Add selected (1)')).toBeTruthy();

    byText('Search')!.click();
    await flushPromises();
    const text = document.body.textContent ?? '';
    expect(text).toContain('No known comet in this photo');
    expect(text).toContain('Near this field');
    expect(text).toMatch(/C\/2025 R2 \(SWAN\).*° from the centre/);
    expect(byText('Add selected')!.disabled).toBe(true);
    expect(mockElements).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('requires a date when the photo has none, then searches on demand', async () => {
    const wrapper = mountModal(makePhoto({ observationDate: null }));
    await flushPromises();
    expect(document.body.textContent).toContain('This photo has no observation date');
    expect(document.body.textContent).not.toContain('C/2025 R2');
    expect(mockElements).not.toHaveBeenCalled();
    expect(byText('Search')!.disabled).toBe(true);

    await setDate('2025-11-07');
    const time = document.body.querySelector('input[type="time"]') as HTMLInputElement;
    time.value = '18:42';
    time.dispatchEvent(new Event('input'));
    await flushPromises();
    expect(document.body.textContent).not.toContain('C/2025 R2');
    byText('Search')!.click();
    await flushPromises();
    expect(document.body.textContent).toContain('C/2025 R2 (SWAN)');
    wrapper.unmount();
  });

  it('emits the predicted position as a comet POI', async () => {
    const wrapper = mountModal(makePhoto());
    await flushPromises();
    byText('Add selected (1)')!.click();
    const [emittedPhoto, pois] = wrapper.emitted('identified')![0] as [Photo, any[]];
    expect(emittedPhoto.id).toBe('p1');
    expect(pois).toHaveLength(1);
    expect(pois[0]).toMatchObject({ name: 'C/2025 R2 (SWAN)', categoryId: 'cat-comet' });
    expect(pois[0].ra).toBeCloseTo(r2At.raDeg, 3);
    expect(pois[0].dec).toBeCloseTo(r2At.decDeg, 3);
    wrapper.unmount();
  });

  it('moves the pin to a clicked nucleus, saves that position, and can reset it', async () => {
    const photo = makePhoto();
    const wrapper = mountModal(photo);
    await flushPromises();
    stubImageRect();
    await flushPromises();

    const container = document.body.querySelector('.modal-photo-container')!;
    container.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 300, bubbles: true }));
    await flushPromises();
    expect(parseFloat(pins()[0].style.left)).toBeCloseTo(400, 0);
    expect(parseFloat(pins()[0].style.top)).toBeCloseTo(300, 0);
    expect(document.body.textContent).toContain('Adjusted');

    byText('Add selected (1)')!.click();
    const [, pois] = wrapper.emitted('identified')![0] as [Photo, any[]];
    const clicked = photoPixelToRaDec(computePhotoToProjMatrix(photo)!, 400, 300);
    expect(pois[0].ra).toBeCloseTo(clicked.ra, 6);
    expect(pois[0].dec).toBeCloseTo(clicked.dec, 6);

    byText('Reset to predicted position')!.click();
    await flushPromises();
    expect(document.body.textContent).not.toContain('Adjusted');
    expect(parseFloat(pins()[0].style.left)).toBeCloseTo(W / 2, -1);
    wrapper.unmount();
  });

  it('still finds the comet while the zenith-centred sky map has its field below the horizon', async () => {
    setCenterMode('zenith');
    // LST 10h at 48°N: RA 22h45m is ~12 h from the meridian, far below the horizon.
    setProjectionObserver(10, 48);
    try {
      const wrapper = mountModal(makePhoto());
      await flushPromises();
      expect(document.body.textContent).toContain('C/2025 R2 (SWAN)');
      byText('Add selected (1)')!.click();
      const [, pois] = wrapper.emitted('identified')![0] as [Photo, any[]];
      expect(pois[0].ra).toBeCloseTo(r2At.raDeg, 3);
      wrapper.unmount();
    } finally {
      setCenterMode('pole');
    }
  });

  it('shows the error when the comet orbits cannot be loaded', async () => {
    mockElements.mockRejectedValue(new Error('Could not load comet orbits (MPC): timeout'));
    const wrapper = mountModal(makePhoto());
    await flushPromises();
    expect(document.body.textContent).toContain('timeout');
    expect(byText('Add selected')!.disabled).toBe(true);
    wrapper.unmount();
  });
});
