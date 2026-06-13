import { describe, it, expect } from 'vitest';
import { formatSetupCanvasLabel } from '../../src/gear-presets';

describe('formatSetupCanvasLabel', () => {
  it('uses degree FOV when both dims >= 1°', () => {
    expect(formatSetupCanvasLabel('My C8', 2.1, 1.4)).toBe('My C8 · 2.1° × 1.4°');
  });

  it('uses arcminute FOV when both dims < 1°', () => {
    expect(formatSetupCanvasLabel('Compact', 0.5, 1 / 3)).toBe("Compact · 30' × 20'");
  });

  it('handles mixed units (w >= 1°, h < 1°)', () => {
    expect(formatSetupCanvasLabel('Wide', 1.2, 0.75)).toBe("Wide · 1.2° × 45'");
  });

  it('uses setup name as primary label', () => {
    const label = formatSetupCanvasLabel('Ritchey-Chrétien 16"', 0.25, 0.16);
    expect(label).toMatch(/^Ritchey-Chrétien 16" · /);
  });
});
