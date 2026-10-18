import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { Star } from '@myastrosky/core/types';
import { ionicStubs } from './helpers';
import SkyStarPick from '../src/pages/sky/SkyStarPick.vue';

/** "Identifier les étoiles, choisir sur la carte": a star of a point chosen by a tap on the map. */

const DENEB: Star = {
  hip: 102098,
  ra: 310.36,
  dec: 45.28,
  mag: 1.25,
  bv: 0.09,
  name: 'Deneb',
  bayer: 'α',
  constellation: 'Cyg',
};

function mockMap() {
  let picked: ((star: Star) => void) | null = null;
  return {
    enterPickingMode: vi.fn((cb: (star: Star) => void) => (picked = cb)),
    exitPickingMode: vi.fn(),
    setHighlightedStar: vi.fn(),
    tap: (star: Star) => picked!(star),
  };
}

describe('choosing a star on the map', () => {
  it('marks the tapped star, names it under the map, and gives it to the point on Valider', async () => {
    localStorage.setItem('lang', 'fr');
    const map = mockMap();
    const w = mount(SkyStarPick, {
      props: { map: map as never, point: 3 },
      global: { stubs: ionicStubs },
    });
    expect(map.enterPickingMode).toHaveBeenCalled();
    const validate = () => w.findAll('button').find((b) => b.text() === 'Valider')!;
    // Nothing tapped yet: only the buttons, Valider waits.
    expect(w.find('.mob-row').exists()).toBe(false);
    expect(validate().attributes('disabled')).toBeDefined();
    map.tap(DENEB);
    await w.vm.$nextTick();
    expect(map.setHighlightedStar).toHaveBeenCalledWith(102098);
    expect(w.find('.mob-row-lead').text()).toBe('3');
    expect(w.find('.mob-row-title').text()).toBe('Deneb (α Cyg)');
    expect(w.find('.mob-row-trail').text()).toBe('mag 1.3');
    await validate().trigger('click');
    expect(w.emitted('picked')).toEqual([[DENEB]]);
    w.unmount();
    expect(map.exitPickingMode).toHaveBeenCalled();
    expect(map.setHighlightedStar).toHaveBeenLastCalledWith(null);
  });

  it('gives nothing back on Annuler', async () => {
    const map = mockMap();
    const w = mount(SkyStarPick, {
      props: { map: map as never, point: 1 },
      global: { stubs: ionicStubs },
    });
    await w
      .findAll('button')
      .find((b) => b.text() === 'Annuler')!
      .trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    expect(w.emitted('picked')).toBeUndefined();
  });
});
