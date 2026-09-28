/**
 * Tests for AsteroidIdentifyModal.vue: marking the trail on the photo converts
 * clicks to photo pixels, times pre-fill from the photo's observation date +
 * integration time, Identify calls the SkyBoT API and ranks results, and
 * choosing a candidate emits `identified` with the photo and the formatted POI
 * — the modal itself never persists (see the component's doc comment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import AsteroidIdentifyModal from '../../src/components/modals/AsteroidIdentifyModal.vue';
import { isoToUtcParts, isoToJd } from '../../src/asteroid-identify';
import type { Photo, ManualPlacement } from '../../src/types';
import { setCenterMode, setProjectionObserver } from '../../src/projection';

vi.mock('../../src/api', () => ({
  skybotConesearchAPI: vi.fn(),
}));

import { skybotConesearchAPI } from '../../src/api';
const mockConesearch = vi.mocked(skybotConesearchAPI);

const placement: ManualPlacement = {
  centerRa: 0,
  centerDec: 90,
  rotationDeg: 0,
  projPerPx: 0.002,
  mirrorX: false,
  mirrorY: false,
};

function makePhoto(overrides?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1.jpg',
    width: 1233,
    height: 931,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: [],
    manualPlacement: placement,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [{ frames: 46, seconds: 30, filter: 'L' }],
    observationDate: '2026-04-08T23:27:47.000Z',
    notes: '',
    ...overrides,
  };
}

function mountModal(photo: Photo = makePhoto()) {
  return mount(AsteroidIdentifyModal, {
    props: { photo },
    global: {
      plugins: [createTestingPinia({ stubActions: true, createSpy: vi.fn })],
    },
    attachTo: document.body,
  });
}

/** Stub the mounted <img>'s layout box to exactly the photo's pixel size (1:1 display scale). */
function stubImageRect(wrapper: ReturnType<typeof mountModal>, width: number, height: number) {
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
  Object.defineProperty(img, 'clientWidth', { value: width, configurable: true });
  img.dispatchEvent(new Event('load'));
}

beforeEach(() => {
  mockConesearch.mockReset();
});

// Teleported (BaseModal) content lives on document.body, not inside the wrapper's
// own root — a plain wrapper.unmount() can leave it behind between tests.
afterEach(() => {
  document.body.innerHTML = '';
});

describe('AsteroidIdentifyModal', () => {
  it('pre-fills start/end date+time (UTC, not local) from observation date + integration time', () => {
    const wrapper = mountModal();
    const dateInputs = document.body.querySelectorAll('input[type="date"]');
    const timeInputs = document.body.querySelectorAll('input[type="time"]');
    expect(dateInputs.length).toBe(2);
    expect(timeInputs.length).toBe(2);
    // 46 x 30s = 1380s after the observation start. These are the *literal UTC*
    // digits (isoToUtcParts), not the local-timezone conversion — the fields are
    // labelled "(UTC)" and must show/accept UTC regardless of the browser's own
    // timezone (see asteroid-identify.ts's isoToUtcParts doc comment for why a
    // native datetime-local was deliberately not used here).
    const start = isoToUtcParts('2026-04-08T23:27:47.000Z');
    const end = isoToUtcParts('2026-04-08T23:50:47.000Z');
    expect((dateInputs[0] as HTMLInputElement).value).toBe(start.date);
    expect((timeInputs[0] as HTMLInputElement).value).toBe(start.time);
    expect((dateInputs[1] as HTMLInputElement).value).toBe(end.date);
    expect((timeInputs[1] as HTMLInputElement).value).toBe(end.time);
    wrapper.unmount();
  });

  it('treats typed date/time digits as literal UTC, independent of local timezone', async () => {
    mockConesearch.mockResolvedValue([]);
    const wrapper = mountModal(makePhoto({ observationDate: null, integrations: [] }));
    stubImageRect(wrapper, 1233, 931);
    await wrapper.vm.$nextTick();

    const clickTarget = document.body.querySelector('.modal-photo-container') as HTMLElement;
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 600, clientY: 460, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 610, clientY: 465, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    const dateInputs = document.body.querySelectorAll('input[type="date"]');
    const timeInputs = document.body.querySelectorAll('input[type="time"]');
    const setVal = (el: Element, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(dateInputs[0], '2026-04-08');
    setVal(timeInputs[0], '23:25');
    setVal(dateInputs[1], '2026-04-08');
    setVal(timeInputs[1], '23:39');
    await wrapper.vm.$nextTick();

    const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Identify'),
    ) as HTMLButtonElement;
    expect(identifyBtn.disabled).toBe(false);
    identifyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    // The mid-epoch JD sent to SkyBoT must be derived from the *literal* UTC
    // digits typed (23:25 / 23:39 UTC) — not those digits reinterpreted as the
    // test runner's local timezone and shifted before conversion.
    const expectedMidJd =
      (isoToJd('2026-04-08T23:25:00.000Z') + isoToJd('2026-04-08T23:39:00.000Z')) / 2;
    expect(mockConesearch).toHaveBeenCalledTimes(1);
    const call = mockConesearch.mock.calls[0][0];
    expect(call.epochJd).toBeCloseTo(expectedMidJd, 6);
    wrapper.unmount();
  });

  it('places the start then end marker from image clicks, converted to photo pixels', async () => {
    const wrapper = mountModal();
    stubImageRect(wrapper, 1233, 931);
    await wrapper.vm.$nextTick();

    const clickTarget = document.body.querySelector('.modal-photo-container') as HTMLElement;
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 100, clientY: 200, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 150, clientY: 220, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    // Two markers should now render (start = success color, end = danger color).
    const markers = document.body.querySelectorAll('.rounded-full.pointer-events-none');
    expect(markers.length).toBe(2);
    wrapper.unmount();
  });

  it('does not enable Identify until both markers and both times are set', () => {
    const wrapper = mountModal();
    const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Identify'),
    ) as HTMLButtonElement;
    expect(identifyBtn.disabled).toBe(true);
    wrapper.unmount();
  });

  it('searches SkyBoT and ranks candidates, then emits identified with the chosen POI', async () => {
    mockConesearch.mockResolvedValue([
      {
        number: '18799',
        name: '1999 JZ73',
        raDeg: 186.966,
        decDeg: 12.89,
        className: 'MB>Middle',
        vMag: 17.6,
        ephemErrArcsec: 0.02,
        distArcsec: 10,
        dRaArcsecPerHour: -33.2244,
        dDecArcsecPerHour: 5.4436,
      },
    ]);

    const wrapper = mountModal();
    stubImageRect(wrapper, 1233, 931);
    await wrapper.vm.$nextTick();

    const clickTarget = document.body.querySelector('.modal-photo-container') as HTMLElement;
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 600, clientY: 460, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 610, clientY: 465, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Identify'),
    ) as HTMLButtonElement;
    expect(identifyBtn.disabled).toBe(false);
    identifyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(mockConesearch).toHaveBeenCalledTimes(1);

    const addBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add as point of interest'),
    ) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const emitted = wrapper.emitted('identified');
    expect(emitted).toBeTruthy();
    const [emittedPhoto, emittedPoi] = emitted![0] as [Photo, { name: string; categoryId: string }];
    expect(emittedPhoto.id).toBe('p1');
    expect(emittedPoi).toEqual({ name: '(18799) 1999 JZ73', categoryId: 'cat-asteroid' });
    wrapper.unmount();
  });

  it('paginates a large result list instead of dumping every row at once', async () => {
    mockConesearch.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        number: String(i),
        name: `Test ${i}`,
        raDeg: 186.966,
        decDeg: 12.89,
        className: 'MB>Middle',
        vMag: 20,
        ephemErrArcsec: 0.02,
        distArcsec: 10,
        dRaArcsecPerHour: -1,
        dDecArcsecPerHour: 1,
      })),
    );

    const wrapper = mountModal();
    stubImageRect(wrapper, 1233, 931);
    await wrapper.vm.$nextTick();

    const clickTarget = document.body.querySelector('.modal-photo-container') as HTMLElement;
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 600, clientY: 460, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 610, clientY: 465, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Identify'),
    ) as HTMLButtonElement;
    identifyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await wrapper.vm.$nextTick();

    // 10 candidates, page size 6: first page shows 6 rows + the same pagination
    // widget (markup/classes/page-range algorithm) as the Targets tab's result
    // list — see targets-view.ts's buildPageList, reused here directly.
    let addButtons = Array.from(document.body.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Add as point of interest'),
    );
    expect(addButtons.length).toBe(6);
    expect(document.body.querySelector('.targets-pagination')).toBeTruthy();
    expect(document.body.querySelector('.targets-pagination-info')?.textContent).toContain('10');

    const nextBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.title === 'Next page',
    ) as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();

    nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    // Second (last) page shows the remaining 4 rows.
    addButtons = Array.from(document.body.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Add as point of interest'),
    );
    expect(addButtons.length).toBe(4);

    // Clicking Next again on the last page is a clamped no-op, not an error.
    nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    addButtons = Array.from(document.body.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Add as point of interest'),
    );
    expect(addButtons.length).toBe(4);
    wrapper.unmount();
  });

  it('centres the pagination widget rather than leaving it stuck left below the results', async () => {
    mockConesearch.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        number: String(i),
        name: `Test ${i}`,
        raDeg: 186.966,
        decDeg: 12.89,
        className: 'MB>Middle',
        vMag: 20,
        ephemErrArcsec: 0.02,
        distArcsec: 10,
        dRaArcsecPerHour: -1,
        dDecArcsecPerHour: 1,
      })),
    );

    const wrapper = mountModal();
    stubImageRect(wrapper, 1233, 931);
    await wrapper.vm.$nextTick();
    const clickTarget = document.body.querySelector('.modal-photo-container') as HTMLElement;
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 600, clientY: 460, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    clickTarget.dispatchEvent(
      new MouseEvent('click', { clientX: 610, clientY: 465, bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Identify'),
    ) as HTMLButtonElement;
    identifyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await wrapper.vm.$nextTick();

    // The pagination widget's immediate parent centres it (flex justify-center),
    // rather than the widget itself sitting flush-left in normal block flow.
    const pagination = document.body.querySelector('.targets-pagination') as HTMLElement;
    expect(pagination.parentElement?.className).toContain('justify-center');
    wrapper.unmount();
  });

  it('sends the same SkyBoT search while the zenith-centred sky map has the field below the horizon', async () => {
    // Field around RA 12h28m, Dec +13°: at LST 0.5h from 48°N it is ~12 h from the meridian.
    const photo = makePhoto({
      manualPlacement: { ...placement, centerRa: 186.97, centerDec: 12.89, projPerPx: 0.00002 },
    });
    const searchParams = async () => {
      mockConesearch.mockReset();
      mockConesearch.mockResolvedValue([]);
      const wrapper = mountModal(photo);
      stubImageRect(wrapper, 1233, 931);
      await wrapper.vm.$nextTick();
      const target = document.body.querySelector('.modal-photo-container') as HTMLElement;
      target.dispatchEvent(new MouseEvent('click', { clientX: 600, clientY: 460, bubbles: true }));
      await wrapper.vm.$nextTick();
      target.dispatchEvent(new MouseEvent('click', { clientX: 610, clientY: 465, bubbles: true }));
      await wrapper.vm.$nextTick();
      const identifyBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Identify'),
      ) as HTMLButtonElement;
      identifyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
      wrapper.unmount();
      document.body.innerHTML = '';
      return mockConesearch.mock.calls[0][0];
    };

    const pole = await searchParams();
    setCenterMode('zenith');
    setProjectionObserver(0.5, 48);
    try {
      const zenith = await searchParams();
      expect(zenith.raDeg).toBeCloseTo(pole.raDeg, 9);
      expect(zenith.decDeg).toBeCloseTo(pole.decDeg, 9);
      expect(zenith.decDeg).toBeCloseTo(12.89, 1);
    } finally {
      setCenterMode('pole');
    }
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
