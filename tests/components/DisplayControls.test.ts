import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { ref } from 'vue';
import CollapsibleSection from '../../src/components/base/CollapsibleSection.vue';
import SliderRow from '../../src/components/base/SliderRow.vue';
import CheckRow from '../../src/components/base/CheckRow.vue';
import DisplayControlsSection from '../../src/components/panels/DisplayControlsSection.vue';

// ─── CollapsibleSection ───────────────────────────────────────────────────────

describe('CollapsibleSection', () => {
  it('renders title', () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'My Section' } });
    expect(wrapper.find('.sidebar-section-header').text()).toContain('My Section');
  });

  it('is open by default', () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'X' } });
    expect(wrapper.find('.sidebar-section').classes()).not.toContain('collapsed');
  });

  it('respects defaultOpen: false', () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'X', defaultOpen: false } });
    expect(wrapper.find('.sidebar-section').classes()).toContain('collapsed');
  });

  it('toggles collapsed on header click', async () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'X', defaultOpen: true } });
    await wrapper.find('.sidebar-section-header').trigger('click');
    expect(wrapper.find('.sidebar-section').classes()).toContain('collapsed');
    await wrapper.find('.sidebar-section-header').trigger('click');
    expect(wrapper.find('.sidebar-section').classes()).not.toContain('collapsed');
  });

  it('renders slot content', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: 'X' },
      slots: { default: '<span class="inner">hello</span>' },
    });
    expect(wrapper.find('.inner').exists()).toBe(true);
  });

  it('controlled mode: open=false starts collapsed', () => {
    const openRef = ref(false);
    const wrapper = mount(CollapsibleSection, { props: { title: 'X', open: openRef.value } });
    expect(wrapper.find('.sidebar-section').classes()).toContain('collapsed');
  });

  it('controlled mode: open=true starts open', () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'X', open: true } });
    expect(wrapper.find('.sidebar-section').classes()).not.toContain('collapsed');
  });

  it('controlled mode: emits update:open on toggle', async () => {
    const wrapper = mount(CollapsibleSection, { props: { title: 'X', open: true } });
    await wrapper.find('.sidebar-section-header').trigger('click');
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false]);
  });
});

// ─── SliderRow ────────────────────────────────────────────────────────────────

describe('SliderRow', () => {
  it('renders label', () => {
    const wrapper = mount(SliderRow, { props: { label: 'Test', min: 0, max: 10, step: 1, modelValue: 5 } });
    expect(wrapper.find('label').text()).toContain('Test');
  });

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(SliderRow, { props: { label: 'X', min: 0, max: 10, step: 1, modelValue: 3 } });
    const input = wrapper.find('input[type="range"]');
    await input.setValue('7');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([7]);
  });

  it('uses formatValue when provided', () => {
    const wrapper = mount(SliderRow, {
      props: { label: 'X', min: 0, max: 14, step: 0.5, modelValue: 14, formatValue: (v: number) => v >= 14 ? '∞' : v.toFixed(1) },
    });
    expect(wrapper.find('.display-controls-mag-value').text()).toBe('∞');
  });

  it('applies 0.4 opacity when disabled', () => {
    const wrapper = mount(SliderRow, { props: { label: 'X', min: 0, max: 10, step: 1, modelValue: 5, disabled: true } });
    const row = wrapper.find('.display-controls-mag-row');
    expect((row.element as HTMLElement).style.opacity).toBe('0.4');
  });

  it('disables the input when disabled prop is true', () => {
    const wrapper = mount(SliderRow, { props: { label: 'X', min: 0, max: 10, step: 1, modelValue: 5, disabled: true } });
    expect((wrapper.find('input[type="range"]').element as HTMLInputElement).disabled).toBe(true);
  });
});

// ─── CheckRow ─────────────────────────────────────────────────────────────────

describe('CheckRow', () => {
  it('renders label', () => {
    const wrapper = mount(CheckRow, { props: { label: 'Show Stars', modelValue: true } });
    expect(wrapper.find('label').text()).toContain('Show Stars');
  });

  it('reflects checked state', () => {
    const wrapper = mount(CheckRow, { props: { label: 'X', modelValue: true } });
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
  });

  it('reflects unchecked state', () => {
    const wrapper = mount(CheckRow, { props: { label: 'X', modelValue: false } });
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  });

  it('emits update:modelValue on change', async () => {
    const wrapper = mount(CheckRow, { props: { label: 'X', modelValue: false } });
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('disables the checkbox when disabled prop is true', () => {
    const wrapper = mount(CheckRow, { props: { label: 'X', modelValue: true, disabled: true } });
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).disabled).toBe(true);
  });

  it('applies 0.4 opacity when disabled', () => {
    const wrapper = mount(CheckRow, { props: { label: 'X', modelValue: true, disabled: true } });
    expect((wrapper.find('label').element as HTMLElement).style.opacity).toBe('0.4');
  });
});

// ─── useDisplayStore ─────────────────────────────────────────────────────────

const mockSetShowStars = vi.hoisted(() => vi.fn());
const mockSetShowGrid = vi.hoisted(() => vi.fn());
const mockSetMaxMag = vi.hoisted(() => vi.fn());
const mockGetEffectiveMaxMag = vi.hoisted(() => vi.fn(() => 9.5));

vi.mock('../../src/stores/canvas', () => ({
  useCanvasStore: () => ({
    skyMap: {
      setShowStars: mockSetShowStars,
      setShowGrid: mockSetShowGrid,
      setMaxMag: mockSetMaxMag,
      getEffectiveMaxMag: mockGetEffectiveMaxMag,
      setShowDSOs: vi.fn(),
      setVisibleDSOTypes: vi.fn(),
      setVisibleDSOCatalogs: vi.fn(),
    },
    overlay: null,
  }),
}));

vi.mock('../../src/display-settings', () => ({
  DSO_TYPES_ALL: ['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?'],
  DSO_CATALOGS_DEFAULT_ON: new Set(['M', 'NGC', 'IC', 'SH2']),
  loadSettings: () => ({
    showStars: true,
    showConstellationLines: true,
    showConstellationNames: true,
    showStarLabels: true,
    showDSOLabels: true,
    showGrid: false,
    showPhotos: true,
    showPhotoOutlines: false,
    visibleLabels: {},
    maxMagnitude: 11,
    autoMagnitude: false,
    maxStarCount: 500,
    maxDSOCount: 200,
    starSliderMax: 1000,
    dsoSliderMax: 500,
    skyOpacity: 0.5,
    backgroundOpacity: 1.0,
    showDSOs: true,
    dsoTypes: ['GxS', 'OC', 'GC'],
    dsoCatalogs: ['M', 'NGC'],
    showStarTooltips: true,
    showDSOTooltips: true,
    simplifiedDSOTooltips: false,
    hemisphere: 'north',
    borderLatDeg: 45,
    mapRotationDeg: 0,
    constellationStyle: 'western',
  }),
  saveSettings: vi.fn(),
}));

import { useDisplayStore } from '../../src/stores/display';

describe('useDisplayStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeStore() {
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false });
    return useDisplayStore(pinia);
  }

  it('loads initial showStars from settings', () => {
    const store = makeStore();
    expect(store.showStars).toBe(true);
  });

  it('setShowStars updates reactive state and calls skyMap', () => {
    const store = makeStore();
    store.setShowStars(false);
    expect(store.showStars).toBe(false);
    expect(mockSetShowStars).toHaveBeenCalledWith(false);
  });

  it('setShowGrid updates reactive state and calls skyMap', () => {
    const store = makeStore();
    store.setShowGrid(true);
    expect(store.showGrid).toBe(true);
    expect(mockSetShowGrid).toHaveBeenCalledWith(true);
  });

  it('setAutoMagnitude calls setMaxMag(null) and reads effectiveMag when enabling', () => {
    const store = makeStore();
    store.setAutoMagnitude(true);
    expect(store.autoMagnitude).toBe(true);
    expect(mockSetMaxMag).toHaveBeenCalledWith(null);
    expect(store.effectiveMag).toBe(9.5);
  });

  it('onMapViewChanged updates mapRotationDeg', () => {
    const store = makeStore();
    store.onMapViewChanged(90, 8.2);
    expect(store.mapRotationDeg).toBe(90);
  });

  it('onMapViewChanged updates effectiveMag only when autoMagnitude is on', () => {
    const store = makeStore();
    store.onMapViewChanged(0, 8.0);
    expect(store.effectiveMag).toBe(0); // autoMagnitude is false initially
    store.setAutoMagnitude(true);
    store.onMapViewChanged(0, 7.5);
    expect(store.effectiveMag).toBe(7.5);
  });

  it('setShowDSOs updates store and calls skyMap', () => {
    const store = makeStore();
    store.setShowDSOs(false);
    expect(store.showDSOs).toBe(false);
  });

  it('setDsoTypes updates store dsoTypes', () => {
    const store = makeStore();
    store.setDsoTypes(['OC', 'GxS']);
    expect(store.dsoTypes).toEqual(['OC', 'GxS']);
  });

  it('setDsoCatalogs updates store', () => {
    const store = makeStore();
    store.setDsoCatalogs(['M']);
    expect(store.dsoCatalogs).toEqual(['M']);
  });
});

// ─── DSOSection ───────────────────────────────────────────────────────────────

const mockSetVisibleDSOTypes = vi.hoisted(() => vi.fn());
const mockSetVisibleDSOCatalogs = vi.hoisted(() => vi.fn());
const mockSetShowDSOs2 = vi.hoisted(() => vi.fn());

vi.mock('../../src/dso-catalog', () => ({
  DSO_CATALOGS_ALL: ['M', 'NGC', 'IC', 'SH2', 'LBN', 'LDN', 'vdB', 'Abell', 'LPN'],
  findDSOsInImage: vi.fn(),
  getDSOById: vi.fn(),
  reloadUserOverrides: vi.fn(),
}));

describe('DSO controls in DisplayControlsSection', () => {
  function mountDSOSection() {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        display: {
          showPhotos: true,
          showDSOs: true,
          dsoTypes: ['GxS', 'OC', 'GC'],
          dsoCatalogs: ['M', 'NGC'],
        },
      },
    });
    return mount(DisplayControlsSection, {
      global: { plugins: [pinia] },
      attachTo: document.body,
    });
  }

  afterEach(() => { document.body.innerHTML = ''; });

  it('renders Types and Catalogs dropdown buttons', () => {
    const wrapper = mountDSOSection();
    const buttons = wrapper.findAll('button.display-dropdown-btn');
    const texts = buttons.map(b => b.text());
    expect(texts.some(t => t.includes('Types'))).toBe(true);
    expect(texts.some(t => t.includes('Catalogs'))).toBe(true);
  });

  it('Types button shows active-count suffix when not all types selected', () => {
    const wrapper = mountDSOSection();
    // initial state: dsoTypes: ['GxS', 'OC', 'GC'] — 3 of 12
    const buttons = wrapper.findAll('button.display-dropdown-btn');
    const typeBtn = buttons.find(b => b.text().includes('Types'));
    expect(typeBtn?.text()).toContain('(3)');
  });

  it('Catalogs button shows active-count suffix when not all catalogs selected', () => {
    const wrapper = mountDSOSection();
    // initial state: dsoCatalogs: ['M', 'NGC'] — 2 of 9
    const buttons = wrapper.findAll('button.display-dropdown-btn');
    const catBtn = buttons.find(b => b.text().includes('Catalogs'));
    expect(catBtn?.text()).toContain('(2)');
  });

  it('Types and Catalogs buttons are disabled when showDSOs is false', async () => {
    const wrapper = mountDSOSection();
    const { useDisplayStore: useDSStore } = await import('../../src/stores/display');
    const store = useDSStore();
    store.showDSOs = false;
    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll('button.display-dropdown-btn');
    const typeBtn = buttons.find(b => b.text().includes('Types'));
    const catBtn = buttons.find(b => b.text().includes('Catalogs'));
    expect((typeBtn?.element as HTMLButtonElement).disabled).toBe(true);
    expect((catBtn?.element as HTMLButtonElement).disabled).toBe(true);
  });
});
