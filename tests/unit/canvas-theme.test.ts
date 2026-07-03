import { describe, expect, it } from 'vitest';
import {
  DSO_MARKER_STYLES,
  DSO_LABEL_COLORS,
  DEFAULT_DSO_LABEL_COLOR,
  FONTS,
} from '../../src/canvas-theme';
import { DSO_TYPES_ALL } from '../../src/display-settings';
import type { DSOType } from '../../src/types';

describe('canvas-theme DSO tables', () => {
  it('has a marker style for every DSO type (no gaps)', () => {
    for (const type of DSO_TYPES_ALL as DSOType[]) {
      const style = DSO_MARKER_STYLES[type];
      expect(style, `missing marker style for ${type}`).toBeDefined();
      // Every marker draws something: a fill, a stroke, or both.
      expect(Boolean(style.fill) || Boolean(style.stroke), `${type} draws nothing`).toBe(true);
    }
  });

  it('every marker style resolves to a valid shape', () => {
    for (const type of DSO_TYPES_ALL as DSOType[]) {
      expect(['ellipse', 'circle']).toContain(DSO_MARKER_STYLES[type].shape);
    }
  });

  it('label colors are a subset of the DSO types (galaxy subtypes fall back)', () => {
    for (const type of Object.keys(DSO_LABEL_COLORS) as DSOType[]) {
      expect(DSO_TYPES_ALL).toContain(type);
    }
    // The documented fallback: galaxy subtypes have no explicit label color.
    expect(DSO_LABEL_COLORS.GxS).toBeUndefined();
    expect(DSO_LABEL_COLORS.GxE).toBeUndefined();
    expect(DSO_LABEL_COLORS.GxI).toBeUndefined();
    expect(DEFAULT_DSO_LABEL_COLOR).toMatch(/^rgba?\(/);
  });

  it('defines the label fonts', () => {
    expect(FONTS.dsoLabel).toMatch(/px/);
    expect(FONTS.starLabel).toMatch(/px/);
    expect(FONTS.gridLabel).toMatch(/px/);
  });
});
