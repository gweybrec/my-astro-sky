/**
 * Tests for IdentifyModalShell.vue — the layout shared by the asteroid, supernova
 * and comet identification modals: search fields + Search button above the photo,
 * Search only on click, photo clicks reported in photo pixels (drags and clicks
 * outside the image ignored), markers placed through toDisplay(), and the
 * Cancel / "Add selected (n)" footer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { h } from 'vue';
import IdentifyModalShell from '../../src/components/modals/IdentifyModalShell.vue';
import type { Photo, ManualPlacement } from '../../src/types';

const W = 800;
const H = 600;

const placement: ManualPlacement = {
  centerRa: 100,
  centerDec: 20,
  rotationDeg: 0,
  projPerPx: 0.00002,
  mirrorX: false,
  mirrorY: false,
};

function makePhoto(overrides?: Partial<Photo>): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'p1',
    width: W,
    height: H,
    createdAt: '2026-01-01T00:00:00.000Z',
    correspondences: [],
    manualPlacement: placement,
    dsoIds: [],
    labels: [],
    pointsOfInterest: [],
    integrations: [],
    observationDate: null,
    notes: '',
    ...overrides,
  };
}

function mountShell(props: Record<string, unknown> = {}, marker?: { x: number; y: number }) {
  return mount(IdentifyModalShell, {
    props: {
      photo: makePhoto(),
      modalClass: 'test-identify-modal',
      title: 'Identify things',
      intro: 'Intro text',
      canSearch: true,
      searching: false,
      selectedCount: 0,
      ...props,
    },
    slots: {
      labels: () => h('label', { class: 'test-label' }, 'Date'),
      inputs: () => h('input', { type: 'date', class: 'test-input' }),
      results: () => h('div', { class: 'test-results' }, 'results here'),
      markers: ({
        toDisplay,
      }: {
        toDisplay: (p: { x: number; y: number }) => { left: number; top: number } | null;
      }) => {
        const pos = marker ? toDisplay(marker) : null;
        return pos
          ? h('span', {
              class: 'test-marker',
              style: { left: `${pos.left}px`, top: `${pos.top}px` },
            })
          : null;
      },
    },
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

const byText = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().startsWith(text),
  ) as HTMLButtonElement | undefined;
const before = (a: Node, b: Node) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('IdentifyModalShell', () => {
  it('puts the intro, the fields and Search above the photo, and the results below it', () => {
    const wrapper = mountShell();
    const photo = document.body.querySelector('.modal-photo-container')!;
    expect(document.body.textContent).toContain('Intro text');
    expect(before(document.body.querySelector('.test-label')!, photo)).toBe(true);
    expect(before(document.body.querySelector('.test-input')!, photo)).toBe(true);
    expect(before(byText('Search')!, photo)).toBe(true);
    expect(before(photo, document.body.querySelector('.test-results')!)).toBe(true);
    wrapper.unmount();
  });

  it('emits search only when the enabled button is clicked', async () => {
    const wrapper = mountShell({ canSearch: false });
    expect(byText('Search')!.disabled).toBe(true);
    await wrapper.setProps({ canSearch: true });
    byText('Search')!.click();
    expect(wrapper.emitted('search')).toHaveLength(1);
    await wrapper.setProps({ searching: true });
    expect(byText('Searching')!.disabled).toBe(true);
    wrapper.unmount();
  });

  it('reports photo clicks in photo pixels and ignores clicks outside the image', async () => {
    const wrapper = mountShell();
    stubImageRect();
    await flushPromises();
    const container = document.body.querySelector('.modal-photo-container')!;
    container.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 150, bubbles: true }));
    container.dispatchEvent(new MouseEvent('click', { clientX: 900, clientY: 150, bubbles: true }));
    expect(wrapper.emitted('photo-click')).toEqual([[{ x: 200, y: 150 }]]);
    wrapper.unmount();
  });

  it('places markers through toDisplay at the image scale', async () => {
    const wrapper = mountShell({}, { x: 300, y: 200 });
    stubImageRect();
    await flushPromises();
    const marker = document.body.querySelector<HTMLElement>('.test-marker')!;
    expect(parseFloat(marker.style.left)).toBeCloseTo(300, 0);
    expect(parseFloat(marker.style.top)).toBeCloseTo(200, 0);
    wrapper.unmount();
  });

  it('shows the error message and a footer whose add button follows the selection count', async () => {
    const wrapper = mountShell({ errorMessage: 'Server is down' });
    expect(document.body.textContent).toContain('Server is down');
    expect(byText('Add selected (0)')!.disabled).toBe(true);
    await wrapper.setProps({ selectedCount: 2 });
    byText('Add selected (2)')!.click();
    expect(wrapper.emitted('add')).toHaveLength(1);
    byText('Cancel')!.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('drops the Search button with hideSearch and shows a custom add label', () => {
    const wrapper = mountShell({ hideSearch: true, addLabel: 'Add it', selectedCount: 1 });
    expect(byText('Search')).toBeUndefined();
    expect(document.body.querySelector('.test-input')).not.toBeNull();
    expect(byText('Add selected')).toBeUndefined();
    byText('Add it')!.click();
    expect(wrapper.emitted('add')).toHaveLength(1);
    wrapper.unmount();
  });

  it('renders nothing but the footer for a photo that is not solved', () => {
    const wrapper = mountShell({ photo: makePhoto({ manualPlacement: undefined }) });
    expect(document.body.querySelector('.modal-photo-container')).toBeNull();
    expect(byText('Search')).toBeUndefined();
    wrapper.unmount();
  });
});
