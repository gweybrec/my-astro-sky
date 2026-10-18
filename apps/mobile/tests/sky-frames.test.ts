import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import type { Plan } from '@myastrosky/app-state/api';
import { ionicStubs, mapSheetHost } from './helpers';

const confirm = vi.fn();
const showError = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
  showInfo: vi.fn(),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/composables/useSetupLines', async () => {
  const { ref } = await import('vue');
  return {
    useSetupLines: () => ({
      lines: ref([
        { setup: { id: 's1', name: 'Équipement 1' }, subs: ['Askar FRA400 + ASI533MC', 'Champ'] },
      ]),
      load: () => Promise.resolve(),
    }),
  };
});

import SkyFrameSheet from '../src/pages/sky/SkyFrameSheet.vue';
import SkyFramesSheet from '../src/pages/sky/SkyFramesSheet.vue';
import SkyFramePicker from '../src/pages/sky/SkyFramePicker.vue';
import PhoneSliderRow from '../src/components/PhoneSliderRow.vue';
import PhoneToggleRow from '../src/components/PhoneToggleRow.vue';
import { frameDragging } from '../src/sky-frames';
import { frameName, frameRotation, frameStatus, newPlanName } from '../src/frame-text';

/** The frames on the Ciel map: "Ciel, cadre sélectionné", "Ciel, contours de champ", "Ciel, créer un cadre". */

const M31 = "Galaxie d'Andromède";
const frame = (over: Partial<RenderableFrame> & { id: string }): RenderableFrame => ({
  name: 'Équipement 1',
  label: 'Équipement 1 · 2.5° × 1.7°',
  wDeg: 2.5,
  hDeg: 1.7,
  active: true,
  movable: true,
  pinnable: true,
  anchorKind: 'sky',
  ra: 10.7,
  dec: 41.3,
  paDeg: 24,
  anchorLabel: M31,
  ...over,
});

const fakeMap = () =>
  ({
    toggleFramePinById: vi.fn(),
    resnapFrame: vi.fn(),
    pinAllFloatingFrames: vi.fn(),
    pinActiveIfFloating: vi.fn(),
    centerFrameInView: vi.fn(),
    selectFrame: vi.fn(),
    viewCenterSky: vi.fn(() => ({ ra: 1, dec: 2 })),
  }) as unknown as SkyMap & Record<string, ReturnType<typeof vi.fn>>;

const plan = (over: Partial<Plan> & { id: string }): Plan =>
  ({ name: over.id, setupId: null, entries: [], mosaics: [], ...over }) as Plan;

const byLabel = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.attributes('aria-label') === name)!;
const byText = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('.mob-row, button').find((b) => b.text().includes(text));

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
  confirm.mockReset().mockResolvedValue(true);
  showError.mockReset();
  push.mockReset();
  frameDragging.value = false;
});

describe('the words of a frame', () => {
  it('names a free frame by its setup and a plan frame by its target', () => {
    expect(frameName(frame({ id: 'adhoc-1' }))).toBe('Équipement 1 · 2.5° × 1.7°');
    expect(frameName(frame({ id: 'plan:p:e' }))).toBe(M31);
    expect(frameName(frame({ id: 'mosaic:p:m', isMosaicOutline: true }))).toBe(`${M31} · Mosaïque`);
  });

  it('says floating, or pinned to its target, then the angle', () => {
    expect(frameStatus(frame({ id: 'adhoc-1' }))).toBe(`Épinglé sur ${M31} · Angle 24°`);
    expect(frameStatus(frame({ id: 'adhoc-1', anchorKind: 'screen' }))).toBe('Flottant');
    expect(
      frameStatus(frame({ id: 'mosaic:p:m', isMosaicOutline: true, paDeg: 0 }), {
        cols: 3,
        rows: 2,
      }),
    ).toBe('3×2 · Angle 0°');
  });

  it('reads the rotation from 0 to 360', () => {
    expect(frameRotation(frame({ id: 'a', paDeg: -10 }))).toBe(350);
    expect(frameRotation(frame({ id: 'a', anchorKind: 'screen', screenRotationDeg: -90 }))).toBe(
      270,
    );
  });

  it('names a new plan after today', () => {
    expect(newPlanName(new Date(2026, 9, 18))).toMatch(/^Nuit du 18 oct\.? 2026$/);
  });
});

describe('the sheet of the selected frame', () => {
  const mountSheet = (f: RenderableFrame, map = fakeMap()) => ({
    map,
    w: mount(SkyFrameSheet, {
      props: { frame: f, map },
      global: { stubs: ionicStubs, provide: mapSheetHost },
    }),
  });

  it('shows the target, the setup, then the rotation, pin, anchor and delete', () => {
    const { w } = mountSheet(frame({ id: 'adhoc-1' }));
    expect(w.find('.mob-sheet-title').text()).toBe(M31);
    expect(w.find('.mob-meta').text()).toBe('Équipement 1 · 2.5° × 1.7°');
    expect(w.findComponent(PhoneSliderRow).props('display')).toBe('24°');
    const toggles = w.findAllComponents(PhoneToggleRow).map((t) => t.props('title'));
    expect(toggles).toEqual(['Épingler', 'Ancrage']);
    expect(byText(w, 'Supprimer le cadre')).toBeTruthy();
  });

  it('turns a pinned frame by its position angle with the slider', async () => {
    const { w } = mountSheet(frame({ id: 'adhoc-1' }));
    const apply = vi.spyOn(useFovFramesStore(), 'applyChange');
    w.findComponent(PhoneSliderRow).vm.$emit('update:modelValue', 19);
    expect(apply).toHaveBeenCalledWith('adhoc-1', { paDeg: 19 });
  });

  it('turns a floating frame by its screen angle', async () => {
    const { w } = mountSheet(
      frame({ id: 'adhoc-1', anchorKind: 'screen', screenRotationDeg: 178 }),
    );
    const apply = vi.spyOn(useFovFramesStore(), 'applyChange');
    w.findComponent(PhoneSliderRow).vm.$emit('update:modelValue', 183);
    expect(apply).toHaveBeenCalledWith('adhoc-1', { screenRotationDeg: -177 });
  });

  it('pins with the map, and snaps again when the anchor comes back on', async () => {
    const { w, map } = mountSheet(frame({ id: 'adhoc-1', anchorSnap: false }));
    const fov = useFovFramesStore();
    fov.toggleAnchorSnap('adhoc-1'); // off, as the frame says
    const [pin, anchor] = w.findAllComponents(PhoneToggleRow);
    pin.vm.$emit('update:modelValue', false);
    anchor.vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(map.toggleFramePinById).toHaveBeenCalledWith('adhoc-1');
    expect(fov.isAnchorSnapOn('adhoc-1')).toBe(true);
    expect(map.resnapFrame).toHaveBeenCalledWith('adhoc-1');
  });

  it('shrinks to its title while the frame is dragged', async () => {
    const { w } = mountSheet(frame({ id: 'adhoc-1' }));
    frameDragging.value = true;
    await flushPromises();
    expect(w.find('.mob-sheet-body').attributes('style')).toContain('display: none');
    expect(w.find('.mob-sheet-title').exists()).toBe(true);
  });

  it('deletes a plan frame after the desktop question', async () => {
    const { w } = mountSheet(frame({ id: 'plan:p1:e1' }));
    const del = vi.spyOn(useFovFramesStore(), 'deletePlanFrame').mockResolvedValue();
    await byText(w, 'Supprimer le cadre')!.trigger('click');
    await flushPromises();
    expect(confirm.mock.calls[0][0].message).toBe(`Retirer « ${M31} » de ce plan ?`);
    expect(del).toHaveBeenCalledWith('plan:p1:e1');
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('keeps the frame when the question is declined', async () => {
    confirm.mockResolvedValue(false);
    const { w } = mountSheet(frame({ id: 'adhoc-1' }));
    const remove = vi.spyOn(useFovFramesStore(), 'removeFrame');
    await byText(w, 'Supprimer le cadre')!.trigger('click');
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();
  });

  it('moves a free frame only into a plan with the same setup', async () => {
    const fov = useFovFramesStore();
    fov.adhoc.push({
      id: 'adhoc-1',
      setupId: 's1',
      anchor: { kind: 'sky', ra: 1, dec: 2, dsoId: null },
      rotationDeg: 0,
    });
    usePlansStore().plans = [
      plan({ id: 'p1', name: 'Nuit A', setupId: 's1' }),
      plan({ id: 'p2', name: 'Nuit B', setupId: 's2' }),
    ];
    const migrate = vi.spyOn(fov, 'migrateFreeFrameToPlan').mockResolvedValue();
    const { w } = mountSheet(frame({ id: 'adhoc-1' }));
    const rows = w.findAll('.mob-row').filter((b) => /Nuit [AB]/.test(b.text()));
    expect(rows.map((r) => r.classes('mob-row--disabled'))).toEqual([false, true]);
    expect(rows[1].text()).toContain('Ce plan utilise une autre configuration matériel');
    await rows[1].trigger('click');
    expect(migrate).not.toHaveBeenCalled();
    await rows[0].trigger('click');
    await flushPromises();
    expect(migrate).toHaveBeenCalledWith('adhoc-1', 'p1');
  });

  it('offers no move for a plan frame', () => {
    usePlansStore().plans = [plan({ id: 'p1' })];
    const { w } = mountSheet(frame({ id: 'plan:p1:e1' }));
    expect(byText(w, 'Déplacer vers un plan')).toBeUndefined();
  });
});

describe('the size of a smart telescope frame', () => {
  const seestar = (over: Partial<RenderableFrame> = {}) =>
    frame({
      id: 'adhoc-s',
      label: 'Seestar S50 · 2.1° × 1.2°',
      wDeg: 2.1,
      hDeg: 1.2,
      paDeg: 0,
      smartMosaic: { env: { maxWDeg: 2.6, maxHDeg: 1.4 }, nativeWDeg: 1.3, nativeHDeg: 0.7 },
      ...over,
    });
  const mountSheet = (f: RenderableFrame) =>
    mount(SkyFrameSheet, {
      props: { frame: f, map: fakeMap() },
      global: { stubs: ionicStubs, provide: mapSheetHost },
    });

  it('shows Largeur, Hauteur and Taille d’origine first, before the rotation', () => {
    const w = mountSheet(seestar());
    const sliders = w.findAllComponents(PhoneSliderRow);
    expect(sliders.map((r) => [r.props('label'), r.props('display')])).toEqual([
      ['Largeur', '2.1°'],
      ['Hauteur', '1.2°'],
      ['Rotation', '0°'],
    ]);
    expect(sliders[0].props('min')).toBe(1.3);
    expect(sliders[0].props('max')).toBe(2.6);
    expect(byText(w, 'Taille d’origine')).toBeTruthy();
    expect(
      mountSheet(seestar({ hDeg: 0.73 }))
        .findAllComponents(PhoneSliderRow)[1]
        .props('display'),
    ).toBe('0.73°');
  });

  it('resizes one side, and back to the native field', async () => {
    const apply = vi.spyOn(useFovFramesStore(), 'applyResize').mockResolvedValue();
    const w = mountSheet(seestar());
    w.findAllComponents(PhoneSliderRow)[0].vm.$emit('update:modelValue', 2.4);
    expect(apply).toHaveBeenLastCalledWith(
      'adhoc-s',
      expect.objectContaining({ wDeg: 2.4, hDeg: 1.2 }),
    );
    await byText(w, 'Taille d’origine')!.trigger('click');
    expect(apply).toHaveBeenLastCalledWith(
      'adhoc-s',
      expect.objectContaining({ wDeg: 1.3, hDeg: 0.7 }),
    );
  });

  it('gives way on the other side under an area cap (Vaonis)', () => {
    const apply = vi.spyOn(useFovFramesStore(), 'applyResize').mockResolvedValue();
    const w = mountSheet(
      seestar({
        wDeg: 3,
        hDeg: 3,
        smartMosaic: {
          env: { maxWDeg: 4.33, maxHDeg: 4.33, maxAreaDeg2: 10.56 },
          nativeWDeg: 2.5,
          nativeHDeg: 1.6,
        },
      }),
    );
    w.findAllComponents(PhoneSliderRow)[1].vm.$emit('update:modelValue', 4.2);
    const region = apply.mock.calls[0][1];
    expect(region.hDeg).toBe(4.2);
    expect(region.wDeg).toBeCloseTo(10.56 / 4.2, 6);
  });

  it('stops the side moved where the area cap binds once the other is at its native size', () => {
    const apply = vi.spyOn(useFovFramesStore(), 'applyResize').mockResolvedValue();
    const w = mountSheet(
      seestar({
        wDeg: 2.6,
        hDeg: 1.4,
        smartMosaic: {
          env: { maxWDeg: 4.33, maxHDeg: 4.33, maxAreaDeg2: 10.56 },
          nativeWDeg: 2.6,
          nativeHDeg: 1.4,
        },
      }),
    );
    w.findAllComponents(PhoneSliderRow)[1].vm.$emit('update:modelValue', 4.33);
    const region = apply.mock.calls[0][1];
    expect(region.wDeg).toBe(2.6);
    expect(region.hDeg).toBeCloseTo(10.56 / 2.6, 6);
  });

  it('does not repeat the title under it for a floating free frame', () => {
    const w = mountSheet(
      seestar({ anchorKind: 'screen', anchorLabel: null, label: "S50 · 1.3° × 44'" }),
    );
    expect(w.find('.mob-sheet-title').text()).toBe("S50 · 1.3° × 44'");
    expect(w.find('.mob-map-sheet > .mob-sheet-drag .mob-meta').exists()).toBe(false);
  });

  it('has no size rows for a frame of a classical telescope', () => {
    const w = mountSheet(frame({ id: 'adhoc-1' }));
    expect(w.findAllComponents(PhoneSliderRow)).toHaveLength(1);
    expect(byText(w, 'Taille d’origine')).toBeUndefined();
  });
});

describe('Contours de champ', () => {
  const mountSheet = (map = fakeMap()) => ({
    map,
    w: mount(SkyFramesSheet, { props: { open: true, map }, global: { stubs: ionicStubs } }),
  });
  function withFreeFrames() {
    const fov = useFovFramesStore();
    fov.specs = new Map([
      [
        's1',
        {
          name: 'Équipement 1',
          label: 'Équipement 1 · 2.5° × 1.7°',
          wDeg: 2.5,
          hDeg: 1.7,
          smart: false,
          mosaic: null,
        },
      ],
    ]);
    fov.adhoc.push(
      {
        id: 'a1',
        setupId: 's1',
        anchor: { kind: 'sky', ra: 10, dec: 41, dsoId: null },
        rotationDeg: 24,
      },
      { id: 'a2', setupId: 's1', anchor: { kind: 'screen', nx: 0.5, ny: 0.5 }, rotationDeg: 0 },
    );
    return fov;
  }

  it('lists the free frames with their tick boxes under "Tout sélectionner"', () => {
    withFreeFrames();
    const { w } = mountSheet();
    const boxes = w.findAll('[role=checkbox]');
    expect(boxes.map((b) => b.attributes('aria-label'))).toEqual([
      'Tout sélectionner',
      'Afficher sur la carte : Équipement 1 · 2.5° × 1.7°',
      'Afficher sur la carte : Équipement 1 · 2.5° × 1.7°',
    ]);
    expect(w.text()).toContain('Épinglé · Angle 24°');
    expect(w.text()).toContain('Flottant');
  });

  it('hides one frame from its tick box', async () => {
    const fov = withFreeFrames();
    const { w } = mountSheet();
    await w.findAll('[role=checkbox]')[1].trigger('click');
    expect(fov.isAdhocVisible('a1')).toBe(false);
    expect(w.findAll('[role=checkbox]')[0].attributes('aria-checked')).toBe('false');
  });

  it('centres and selects a frame tapped in the list, and closes', async () => {
    withFreeFrames();
    const { w, map } = mountSheet();
    await w.find('.mob-check-lead-text').trigger('click');
    expect(map.selectFrame).toHaveBeenCalledWith('a1');
    expect(w.emitted('show')).toEqual([['a1']]);
    expect(w.emitted('update:open')).toEqual([[false]]);
  });

  it('fixes floating frames to the sky before hiding all frames', () => {
    const fov = withFreeFrames();
    const { w, map } = mountSheet();
    w.findComponent(PhoneToggleRow).vm.$emit('update:modelValue', false);
    expect(map.pinAllFloatingFrames).toHaveBeenCalled();
    expect(fov.framesVisible).toBe(false);
  });

  it('adds a free frame with the setup chosen', async () => {
    const fov = withFreeFrames();
    const add = vi.spyOn(fov, 'addAdhocFrame');
    const { w } = mountSheet();
    await byText(w, 'Ajouter un cadre')!.trigger('click');
    await flushPromises();
    await byText(w, 'Askar')!.trigger('click');
    expect(add).toHaveBeenCalledWith('s1');
  });

  it("places a plan's new frame in the middle of the map", async () => {
    const fov = useFovFramesStore();
    usePlansStore().plans = [plan({ id: 'p1', name: 'Nuit A', setupId: 's1' })];
    fov.setSelection({ kind: 'plan', planId: 'p1' });
    const add = vi.spyOn(fov, 'addPlanFrame').mockResolvedValue();
    const { w } = mountSheet();
    await byText(w, 'Ajouter un cadre')!.trigger('click');
    expect(add).toHaveBeenCalledWith('p1', 1, 2);
    await byText(w, 'Ouvrir les détails du plan')!.trigger('click');
    expect(push).toHaveBeenCalledWith('/plans/p1');
  });

  it('says when a plan has no setup', () => {
    const fov = useFovFramesStore();
    usePlansStore().plans = [plan({ id: 'p1', name: 'Nuit A' })];
    fov.setSelection({ kind: 'plan', planId: 'p1' });
    const { w } = mountSheet();
    expect(w.text()).toContain('Ce plan n’a pas de configuration matériel');
    expect(byText(w, 'Ajouter un cadre')).toBeUndefined();
  });
});

describe('Créer un cadre', () => {
  const target = { dsoId: 'M31', ra: 10.7, dec: 41.3, name: M31 };
  const mountPicker = () =>
    mount(SkyFramePicker, { props: { open: true, target }, global: { stubs: ionicStubs } });

  it('adds the object to a plan and shows that plan', async () => {
    const plans = usePlansStore();
    plans.plans = [plan({ id: 'p1', name: 'Nuit A' })];
    const addEntry = vi.spyOn(plans, 'addEntry').mockResolvedValue();
    const w = mountPicker();
    await byText(w, 'Nuit A')!.trigger('click');
    await flushPromises();
    expect(addEntry).toHaveBeenCalledWith('p1', 'M31');
    expect(useFovFramesStore().selection).toEqual({ kind: 'plan', planId: 'p1' });
    expect(w.emitted('plan')).toHaveLength(1);
  });

  it('adds a free frame pinned on the object', async () => {
    const add = vi.spyOn(useFovFramesStore(), 'addAdhocFrameAtSky');
    const w = mountPicker();
    await flushPromises();
    await byText(w, 'Askar')!.trigger('click');
    expect(add).toHaveBeenCalledWith('s1', 10.7, 41.3, 'M31');
    expect(w.emitted('free')).toHaveLength(1);
  });

  it('opens the setup editor for a new setup', async () => {
    const w = mountPicker();
    await byText(w, 'Nouveau setup')!.trigger('click');
    expect(push).toHaveBeenCalledWith('/settings/setups/new');
  });
});
