import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { AltAzPoint } from '@myastrosky/core/sky-map-types';
import { ionicStubs } from './helpers';

const create = vi.fn();
const showError = vi.fn();
vi.mock('@myastrosky/app-state/stores/sky-regions', () => ({
  useSkyRegionsStore: () => ({ create }),
}));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showError }) }));

import SkyRegionDraw from '../src/pages/sky/SkyRegionDraw.vue';
import SkyRegionView from '../src/pages/sky/SkyRegionView.vue';

/** "Dessiner une région" and "Voir une région": the map in local sky, a region drawn with a finger or shown. */

const OUTLINE: AltAzPoint[] = [
  { azDeg: 0, altDeg: 20 },
  { azDeg: 40, altDeg: 20 },
  { azDeg: 40, altDeg: 50 },
];

/** A map that draws as the real one does: each stroke ends the drawing gesture, `cancelRegionDrawMode` cancels it. */
function mockMap({ located = true, localSky = false } = {}) {
  let gesture: {
    done: (p: AltAzPoint[]) => void;
    cancel: () => void;
    strokes: { onPress?: () => void; onAbort?: () => void };
  } | null = null;
  const map = {
    local: localSky,
    resize: vi.fn(),
    getView: () => ({ width: 412, height: 600 }),
    getLocalSkyMode: vi.fn(() => map.local),
    setLocalSkyMode: vi.fn((v: boolean) => (map.local = v)),
    setActiveRegionOverlay: vi.fn(),
    enterRegionDrawMode: vi.fn(
      (
        done: (p: AltAzPoint[]) => void,
        cancel: () => void,
        strokes: { onPress?: () => void; onAbort?: () => void } = {},
      ) => {
        if (!located) return false;
        gesture = { done, cancel, strokes };
        return true;
      },
    ),
    cancelRegionDrawMode: vi.fn(() => {
      const g = gesture;
      gesture = null;
      g?.cancel();
    }),
    /** One finger: lands, draws, lifts. */
    stroke(points: AltAzPoint[]) {
      const g = gesture!;
      gesture = null;
      g.strokes.onPress?.();
      if (points.length >= 3) g.done(points);
      else g.cancel();
    },
    /** A finger lands, then a second one: the stroke is dropped and the map moves. */
    twoFingers() {
      gesture!.strokes.onPress?.();
      gesture!.strokes.onAbort?.();
    },
    get drawing() {
      return gesture !== null;
    },
  };
  return map;
}

function mountDraw(map: ReturnType<typeof mockMap>) {
  const mapEl = document.createElement('div');
  document.body.appendChild(mapEl);
  return mount(SkyRegionDraw, {
    props: { map: map as never, mapEl },
    global: { stubs: ionicStubs },
    attachTo: document.body,
  });
}

const button = (w: ReturnType<typeof mountDraw>, text: string) =>
  w.findAll('button').find((b) => b.text() === text)!;

beforeEach(() => {
  localStorage.setItem('lang', 'fr');
  create.mockReset();
  showError.mockReset();
});

describe('drawing a sky region', () => {
  it('puts the map in local sky, draws strokes one after another, and saves the last with its name and colour', async () => {
    const map = mockMap();
    const w = mountDraw(map);
    expect(map.setLocalSkyMode).toHaveBeenCalledWith(true);
    expect(map.drawing).toBe(true);
    expect(document.body.textContent).toContain(
      'Un doigt : dessiner · Deux doigts : déplacer la carte',
    );
    expect(button(w, 'Terminer').attributes('disabled')).toBeDefined();
    expect(button(w, 'Effacer le tracé').attributes('disabled')).toBeDefined();

    map.stroke(OUTLINE);
    await flushPromises();
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith({
      color: '#4ea1ff',
      points: OUTLINE,
    });
    // The drawing goes on: the next stroke replaces this one; a stroke too short leaves it.
    expect(map.drawing).toBe(true);
    map.stroke(OUTLINE.slice(0, 1));
    await flushPromises();
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith({
      color: '#4ea1ff',
      points: OUTLINE,
    });
    expect(map.drawing).toBe(true);

    // A name is needed too.
    expect(button(w, 'Terminer').attributes('disabled')).toBeDefined();
    await w.find('input').setValue('  Vue depuis le jardin ');
    const picker = w.find('input[type="color"]');
    await picker.setValue('#e6a23c');
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith({
      color: '#e6a23c',
      points: OUTLINE,
    });
    await button(w, 'Terminer').trigger('click');
    await flushPromises();
    expect(create).toHaveBeenCalledWith('Vue depuis le jardin', '#e6a23c', OUTLINE);
    expect(w.emitted('saved')).toHaveLength(1);

    w.unmount();
    expect(map.cancelRegionDrawMode).toHaveBeenCalled();
    expect(map.drawing).toBe(false);
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith(null);
    expect(map.setLocalSkyMode).toHaveBeenLastCalledWith(false);
  });

  it('hides the outline when a new stroke starts, and Effacer le tracé removes it', async () => {
    const map = mockMap();
    const w = mountDraw(map);
    map.stroke(OUTLINE);
    const before = map.setActiveRegionOverlay.mock.calls.length;
    map.stroke(OUTLINE.slice(1));
    expect(map.setActiveRegionOverlay.mock.calls[before]).toEqual([null]);
    map.stroke(OUTLINE);
    map.twoFingers();
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith({
      color: '#4ea1ff',
      points: OUTLINE,
    });
    expect(map.drawing).toBe(true);
    await flushPromises();
    await button(w, 'Effacer le tracé').trigger('click');
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith(null);
    await w.find('input').setValue('Ciel du nord');
    expect(button(w, 'Terminer').attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('leaves the map in local sky when it was already, and gives up on Annuler', async () => {
    const map = mockMap({ localSky: true });
    const w = mountDraw(map);
    expect(map.setLocalSkyMode).not.toHaveBeenCalled();
    await button(w, 'Annuler').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    w.unmount();
    expect(map.setLocalSkyMode).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('says the location is missing and gives up when the map cannot draw', async () => {
    const map = mockMap({ located: false });
    const w = mountDraw(map);
    expect(showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Définissez d'abord une position d'observation" }),
    );
    expect(w.emitted('cancel')).toHaveLength(1);
    w.unmount();
  });

  it('keeps the drawing when the region cannot be saved', async () => {
    create.mockRejectedValueOnce(new Error('disk full'));
    const map = mockMap();
    const w = mountDraw(map);
    map.stroke(OUTLINE);
    await w.find('input').setValue('Jardin');
    await button(w, 'Terminer').trigger('click');
    await flushPromises();
    expect(showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Échec de l'enregistrement de la région." }),
    );
    expect(w.emitted('saved')).toBeUndefined();
    expect(button(w, 'Terminer').attributes('disabled')).toBeUndefined();
    w.unmount();
  });
});

describe('showing a sky region', () => {
  it('draws the region in its colour in local sky, and takes both away when it goes', () => {
    const map = mockMap();
    const region = { id: 'r1', name: 'Jardin', color: '#5ec27a', points: OUTLINE, position: 0 };
    const w = mount(SkyRegionView, { props: { map: map as never, region } });
    expect(map.setLocalSkyMode).toHaveBeenCalledWith(true);
    expect(map.setActiveRegionOverlay).toHaveBeenCalledWith({
      color: '#5ec27a',
      points: OUTLINE,
    });
    w.unmount();
    expect(map.setActiveRegionOverlay).toHaveBeenLastCalledWith(null);
    expect(map.setLocalSkyMode).toHaveBeenLastCalledWith(false);
  });
});
