import { describe, it, expect } from 'vitest';
import { frameTargetDso } from '../../src/fov-frame-target';

describe('frameTargetDso — target of a freely-placed plan frame', () => {
  it('a single DSO inside the frame becomes the target', () => {
    expect(frameTargetDso(['M43'])).toBe('M43');
  });

  it('the DSO nearest the centre wins (list is pre-sorted nearest-first)', () => {
    expect(frameTargetDso(['NGC1', 'NGC2', 'NGC3'])).toBe('NGC1');
  });

  it('no stickiness: the centred object wins even if another is clipped in a corner', () => {
    // The frame is re-centred on NGC5033; NGC5005 lingers in a corner (last).
    expect(frameTargetDso(['NGC5033', 'NGC5005'])).toBe('NGC5033');
  });

  it('no DSO inside the frame → null (custom location)', () => {
    expect(frameTargetDso([])).toBeNull();
  });
});
