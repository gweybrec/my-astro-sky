import { describe, expect, it } from 'vitest';
import { pagesByLine } from '../src/chip-pages';

/** The pages of the photo sheet's chips: at most two lines each, cut where the chips wrap. */
describe('pagesByLine', () => {
  it('keeps one line on one page', () => {
    expect(pagesByLine(['a', 'b'], [0, 0])).toEqual([['a', 'b']]);
  });

  it('starts a page after every two lines', () => {
    expect(pagesByLine(['a', 'b', 'c', 'd', 'e'], [0, 0, 56, 112, 112])).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
  });

  it('counts a chip within a pixel of a line as on that line', () => {
    expect(pagesByLine(['a', 'b', 'c'], [0, 0.6, 56])).toEqual([['a', 'b', 'c']]);
  });

  it('has no page without chips', () => {
    expect(pagesByLine([], [])).toEqual([]);
  });
});
