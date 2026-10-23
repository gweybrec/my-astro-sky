/**
 * Tests for PoiAddModal.vue: name + type at the top, a click on the solved photo places
 * the POI, and "Add" emits it with the clicked position as RA/Dec — the modal never
 * persists. Add stays disabled until name, type and position are all set.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PoiAddModal from '../../src/components/modals/PoiAddModal.vue';
import type { ManualPlacement, Photo, PointOfInterest } from '@myastrosky/core/types';

const W = 800;
const H = 600;
const categories = [
  { id: 'cat-a', name: 'Galaxy', color: '#f00', position: 0 },
  { id: 'cat-b', name: 'Nebula', color: '#0f0', position: 1 },
];
const placement: ManualPlacement = {
  centerRa: 0,
  centerDec: 90,
  rotationDeg: 0,
  projPerPx: 0.002,
  mirrorX: false,
  mirrorY: false,
};
const photo: Photo = {
  id: 'p1',
  filename: 'p1.jpg',
  originalName: 'p1.jpg',
  width: W,
  height: H,
  createdAt: '2026-01-01T00:00:00.000Z',
  correspondences: [],
  manualPlacement: placement,
  dsoIds: [],
  labels: [],
  pointsOfInterest: [],
  notes: '',
};

function mountModal() {
  return mount(PoiAddModal, {
    props: { photo },
    global: {
      plugins: [
        createTestingPinia({
          stubActions: true,
          createSpy: vi.fn,
          initialState: { poiCategories: { categories, loaded: true } },
        }),
      ],
    },
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

const addButton = () =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')!;

async function typeName(value: string) {
  const input = document.body.querySelector('input[type="text"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

async function clickPhoto(x: number, y: number) {
  const container = document.body.querySelector('.modal-photo-container') as HTMLElement;
  container.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  await flushPromises();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PoiAddModal', () => {
  it('has no Search button and keeps Add disabled until name and position are set', async () => {
    const wrapper = mountModal();
    await flushPromises();
    stubImageRect();

    expect(
      [...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Search'),
    ).toBe(false);
    expect(addButton().disabled).toBe(true);

    await typeName('My Target');
    expect(addButton().disabled).toBe(true);

    await clickPhoto(W / 2, H / 2);
    expect(addButton().disabled).toBe(false);
    wrapper.unmount();
  });

  it('emits the POI with the chosen type and the clicked position as RA/Dec', async () => {
    const wrapper = mountModal();
    await flushPromises();
    stubImageRect();

    await typeName('  My Target ');
    const select = document.body.querySelector('select') as HTMLSelectElement;
    select.value = 'cat-b';
    select.dispatchEvent(new Event('change'));
    await clickPhoto(W / 2, H / 2);
    addButton().click();
    await flushPromises();

    const ev = wrapper.emitted('identified');
    expect(ev).toBeTruthy();
    const [emittedPhoto, pois] = ev![0] as [Photo, PointOfInterest[]];
    expect(emittedPhoto).toEqual(photo);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('My Target');
    expect(pois[0].categoryId).toBe('cat-b');
    // The frame is centred on the north celestial pole: the centre pixel is at Dec ≈ +90°.
    expect(pois[0].dec).toBeGreaterThan(89);
    expect(pois[0].ra).toBeGreaterThanOrEqual(0);
    expect(pois[0].ra).toBeLessThan(360);
    wrapper.unmount();
  });
});
