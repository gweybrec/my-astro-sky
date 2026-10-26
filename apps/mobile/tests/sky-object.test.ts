import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import { writeObserverLocation } from '@myastrosky/core/observer-location';
import type { DSO } from '@myastrosky/core/types';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { ionicStubs, mapSheetHost } from './helpers';

// The page's own lifecycle hooks run at once in these tests.
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  onIonViewDidEnter: (fn: () => void) => fn(),
  onIonViewWillLeave: () => {},
}));

import SkyObjectSheet from '../src/pages/sky/SkyObjectSheet.vue';
import type { SkySelection } from '../src/composables/useSkySelection';
import { useBackClose } from '../src/composables/useBackClose';

/** "Ciel, objet sélectionné": the sheet of the selected object, and the back button that closes it. */

const M31 = {
  id: 'M31',
  catalogs: ['M31', 'NGC224'],
  displayName: "Galaxie d'Andromède",
  type: 'GxS',
  constellation: 'And',
  mag: 3.4,
  ra: 10.68,
  dec: 41.27,
} as unknown as DSO;

const VEGA = {
  hip: 91262,
  name: 'Vega',
  bayer: 'α',
  constellation: 'Lyr',
  ra: 279.23,
  dec: 38.78,
  mag: 0.03,
  bv: 0,
};
const mountSheet = (
  selection: Exclude<SkySelection, { kind: 'photo' }> = { kind: 'dso', dso: M31 },
) =>
  mount(SkyObjectSheet, {
    props: { selection },
    global: { stubs: ionicStubs, provide: mapSheetHost },
  });
const factsOf = (w: ReturnType<typeof mount>) =>
  w
    .findAll('.mob-fact')
    .map((f) => [f.find('.mob-fact-label').text(), f.find('.mob-fact-value').text()]);

describe('the object sheet', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });

  it('names the object as the board does: name, designation, type and constellation', () => {
    const w = mountSheet();
    expect(w.find('.mob-sheet-title').text()).toBe("Galaxie d'Andromède");
    expect(w.find('.mob-meta').text()).toContain('M31');
    expect(w.find('.mob-badge--type').text()).toBe('Galaxie spirale');
    expect(w.find('.mob-badge--const').text()).toBe('AND');
  });

  it('shows only the magnitude without a location', () => {
    expect(factsOf(mountSheet())).toEqual([['Magnitude', '3.4']]);
  });

  it('lists its facts without cards, each as wide as its text, values in body text (design system revision 24)', () => {
    const w = mountSheet();
    expect(w.find('.mob-facts').classes()).toEqual(['mob-facts']);
    expect(w.find('.mob-fact-value').classes()).toContain('m-body');
    expect(w.find('.mob-fact-value').classes()).not.toContain('m-body-strong');
  });

  it('adds the transit tonight once there is a location, and the altitude too in date mode', () => {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    const live = factsOf(mountSheet());
    expect(live.map((f) => f[0])).toEqual(['Transit', 'Magnitude']);
    expect(live[0][1]).toMatch(/^\d{2}:\d{2}$/);

    useSkyTimeStore().setMode('date');
    const date = factsOf(mountSheet());
    expect(date.map((f) => f[0])).toEqual(['Altitude', 'Transit', 'Magnitude']);
    expect(date[0][1]).toMatch(/^-?\d+°$/);
  });

  it('has the four actions of the board, all usable; no details button, the facts are in the sheet', () => {
    const labels = mountSheet()
      .findAll('.mob-icon-row button')
      .map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Ajouter un cadre',
      'Ajouter une mosaïque',
      'Ajouter au plan',
      'Modifier',
    ]);
    expect(mountSheet().findAll('.mob-icon-row button[aria-disabled="true"]')).toHaveLength(0);
  });

  it("asks the page for the object's corrections page, and opens the plan picker for the object", async () => {
    const w = mountSheet();
    await w.find('.mob-icon-row button[aria-label="Modifier"]').trigger('click');
    expect(w.emitted('edit')).toHaveLength(1);
    expect(w.find('.mob-sheet-modal:not(.mob-sheet-modal--map)').attributes('is-open')).toBe(
      'false',
    );
    await w.find('.mob-icon-row button[aria-label="Ajouter au plan"]').trigger('click');
    expect(w.find('.mob-sheet-modal:not(.mob-sheet-modal--map)').attributes('is-open')).toBe(
      'true',
    );
    expect(w.find('.mob-sheet-modal:not(.mob-sheet-modal--map)').text()).toContain(
      "Galaxie d'Andromède",
    );
  });

  it('asks the page for "Créer un cadre" and "Créer une mosaïque"', async () => {
    const w = mountSheet();
    await w.find('.mob-icon-row button[aria-label="Ajouter un cadre"]').trigger('click');
    expect(w.emitted('addFrame')).toHaveLength(1);
    await w.find('.mob-icon-row button[aria-label="Ajouter une mosaïque"]').trigger('click');
    expect(w.emitted('addMosaic')).toHaveLength(1);
  });

  it("closes from the handle and by Ionic's drag down", async () => {
    const w = mountSheet();
    await w.find('.mob-sheet-grab').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
    w.findComponent(ionicStubs.IonModal).vm.$emit('didDismiss', { detail: { role: 'gesture' } });
    expect(w.emitted('close')).toHaveLength(2);
  });
});

describe('the sheet of a star', () => {
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    configureStorage(createMemoryStore());
    setActivePinia(createPinia());
  });
  const star = (over: object = {}): Exclude<SkySelection, { kind: 'photo' }> => ({
    kind: 'star',
    star: { ...VEGA, ...over },
  });

  it('names the star with its designation and constellation, and no type badge', () => {
    const w = mountSheet(star());
    expect(w.find('.mob-sheet-title').text()).toBe('Vega');
    expect(w.find('.mob-meta').text()).toContain('α Lyr');
    expect(w.find('.mob-badge--type').exists()).toBe(false);
    expect(w.find('.mob-badge--const').text()).toBe('LYR');
  });

  it('writes the magnitude with two decimals, as the desktop does for stars', () => {
    expect(factsOf(mountSheet(star()))).toEqual([['Magnitude', '0.03']]);
  });

  it('takes the Bayer name for the title when the star has no name, then HIP', () => {
    expect(
      mountSheet(star({ name: undefined }))
        .find('.mob-sheet-title')
        .text(),
    ).toBe('α Lyr');
    expect(
      mountSheet(star({ name: undefined, bayer: undefined, constellation: undefined }))
        .find('.mob-sheet-title')
        .text(),
    ).toBe('HIP 91262');
  });

  it('gives a multiple star its multiplicity in the badge', () => {
    const w = mountSheet(star({ multiplicity: { components: 2, sep: 3.2 } }));
    expect(w.find('.mob-badge--type').text()).toContain('3.2');
  });

  it('has the desktop actions of a star: a frame and a mosaic (the desktop has no star editor)', () => {
    const labels = mountSheet(star())
      .findAll('.mob-icon-row button')
      .map((b) => b.attributes('aria-label'));
    expect(labels).toEqual(['Ajouter un cadre', 'Ajouter une mosaïque']);
    expect(mountSheet(star()).find('.mob-sheet-modal:not(.mob-sheet-modal--map)').exists()).toBe(
      false,
    );
  });

  it('keeps its few actions at the start of the row, where the four of an object are spread', () => {
    expect(mountSheet(star()).find('.mob-icon-row').classes()).toContain('mob-icon-row--start');
    expect(mountSheet().find('.mob-icon-row').classes()).not.toContain('mob-icon-row--start');
  });

  it('shows the altitude and the transit with a location, like an object', () => {
    writeObserverLocation(48.58, 7.75);
    setActivePinia(createPinia());
    useSkyTimeStore().setMode('date');
    expect(factsOf(mountSheet(star())).map((f) => f[0])).toEqual([
      'Altitude',
      'Transit',
      'Magnitude',
    ]);
  });
});

describe('the back button with the sheet open', () => {
  const press = () => {
    let handler: ((processNext: () => void) => void) | undefined;
    document.dispatchEvent(
      new CustomEvent('ionBackButton', {
        detail: { register: (_priority: number, h: typeof handler) => (handler = h) },
      }),
    );
    const next = vi.fn();
    handler?.(next);
    return { next, registered: handler !== undefined };
  };
  const mountHost = (isOpen: () => boolean, close: () => void) =>
    mount(
      defineComponent({
        setup() {
          useBackClose(isOpen, close);
          return () => h('div');
        },
      }),
    );

  it('closes the sheet instead of going on', () => {
    const close = vi.fn();
    const w = mountHost(() => true, close);
    const { next } = press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    w.unmount();
  });

  it('goes on to the next handler when the sheet is closed', () => {
    const close = vi.fn();
    const w = mountHost(() => false, close);
    const { next } = press();
    expect(close).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('stops listening when the page is gone', () => {
    const w = mountHost(() => true, vi.fn());
    w.unmount();
    expect(press().registered).toBe(false);
  });

  it('leaves the press to a page pushed above it, as the back arrow of that page does', async () => {
    // The map's tab keeps its sheet open under a page pushed above the tabs, and is not told it was left.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
    });
    await router.push('/tabs/sky');
    const close = vi.fn();
    const w = mount(
      defineComponent({
        setup() {
          useBackClose(() => true, close);
          return () => h('div');
        },
      }),
      { global: { plugins: [router] } },
    );
    expect(press().next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    await router.push('/sky/draw-order');
    const { next } = press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
