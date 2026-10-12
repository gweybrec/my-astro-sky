import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PIN_SVG_PATH_D } from '@myastrosky/render/sky-draw';

describe('pushpin glyph path', () => {
  it('equals the d attribute of src/icons/pin.svg', () => {
    const svg = fs.readFileSync(path.resolve(__dirname, '../../src/icons/pin.svg'), 'utf8');
    expect(svg.match(/\bd="([^"]+)"/)?.[1]).toBe(PIN_SVG_PATH_D);
  });
});
