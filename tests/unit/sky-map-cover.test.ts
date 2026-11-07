import { describe, expect, it } from 'vitest';
import { centreBesideCover, centreForScreenOffset } from '@myastrosky/render/sky-map';
import { toCanvas } from '@myastrosky/core/projection';

/** A sheet covering part of the phone's map: a target is brought to the middle of the part left uncovered. */
describe('centreBesideCover', () => {
  const target = { x: 0.12, y: -0.34 };
  const at = (cover: { left: number; bottom: number }, rotationDeg: number) => {
    const scale = 900;
    const centre = centreBesideCover(target, cover, scale, { rotationDeg });
    const view = {
      centerX: centre.x,
      centerY: centre.y,
      scale,
      rotationDeg,
      width: 412,
      height: 800,
    };
    return toCanvas(target.x, target.y, view);
  };

  for (const rotationDeg of [0, 37, 180, -95]) {
    it(`a sheet at the bottom: half its height above the middle, map turned ${rotationDeg}°`, () => {
      const p = at({ left: 0, bottom: 400 }, rotationDeg);
      expect(p.x).toBeCloseTo(206, 6);
      expect(p.y).toBeCloseTo(200, 6);
    });

    it(`a sheet at the left: half its width right of the middle, map turned ${rotationDeg}°`, () => {
      const p = at({ left: 300, bottom: 0 }, rotationDeg);
      expect(p.x).toBeCloseTo(356, 6);
      expect(p.y).toBeCloseTo(400, 6);
    });
  }

  it('leaves the target in the middle when nothing covers the map', () => {
    expect(centreBesideCover(target, { left: 0, bottom: 0 }, 900, { rotationDeg: 10 })).toEqual(
      target,
    );
  });
});

/** A floating frame on the phone's map: a searched object is brought under it, wherever it is on the screen. */
describe('centreForScreenOffset', () => {
  const target = { x: -0.2, y: 0.05 };
  for (const rotationDeg of [0, 37, 180, -95]) {
    it(`puts the target at a point off the middle, map turned ${rotationDeg}°`, () => {
      const scale = 1200;
      const centre = centreForScreenOffset(target, { x: 80, y: -150 }, scale, { rotationDeg });
      const view = {
        centerX: centre.x,
        centerY: centre.y,
        scale,
        rotationDeg,
        width: 412,
        height: 800,
      };
      const p = toCanvas(target.x, target.y, view);
      expect(p.x).toBeCloseTo(206 + 80, 6);
      expect(p.y).toBeCloseTo(400 - 150, 6);
    });
  }

  it('leaves the target in the middle with no offset', () => {
    expect(centreForScreenOffset(target, { x: 0, y: 0 }, 900, { rotationDeg: 10 })).toEqual(target);
  });
});
