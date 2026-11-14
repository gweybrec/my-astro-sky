import { describe, it, expect, beforeEach } from 'vitest';
import {
  setStarCatalog,
  setConstellationLines,
  getConstellationVertexMags,
} from '@myastrosky/core/catalog/star-registry';
import type { Star } from '@myastrosky/core/types';

const star = (hip: number, ra: number, dec: number, mag: number): Star => ({
  hip,
  ra,
  dec,
  mag,
  bv: 0.5,
});

describe('getConstellationVertexMags', () => {
  beforeEach(() => {
    setStarCatalog(
      [
        star(1, 10, 20, 2.1),
        star(2, 10.05, 20.02, 5.5), // fainter neighbour of star 1
        star(3, 359.95, 45, 3.4), // just west of RA 0
        star(4, 120, -30, 9), // too faint to be a figure star
      ],
      {},
    );
  });

  it('gives each vertex the magnitude of the brightest star at it, in the lines’ nesting', () => {
    setConstellationLines('western', [
      {
        id: 'A',
        segments: [
          [
            [10.01, 20.01],
            [0.05, 45], // across RA 0 from star 3
          ],
        ],
      },
    ]);
    expect(getConstellationVertexMags('western')).toEqual([[[2.1, 3.4]]]);
  });

  it('is Infinity where no naked-eye star is near the vertex', () => {
    setConstellationLines('western', [
      {
        id: 'B',
        segments: [
          [
            [200, 10],
            [120, -30],
          ],
        ],
      },
    ]);
    expect(getConstellationVertexMags('western')).toEqual([[[Infinity, Infinity]]]);
  });

  it('is rebuilt when the lines of the style change', () => {
    setConstellationLines('western', [{ id: 'A', segments: [[[10, 20]]] }]);
    expect(getConstellationVertexMags('western')).toEqual([[[2.1]]]);
    setConstellationLines('western', [{ id: 'A', segments: [[[359.95, 45]]] }]);
    expect(getConstellationVertexMags('western')).toEqual([[[3.4]]]);
  });
});
