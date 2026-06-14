import { describe, it, expect } from 'vitest';
import { scaleMatrixForDpr, computeGalleryLayout, computeFramedViewScale } from '../../src/export-render';
import { angularSizeToCanvasPxForDSO } from '../../src/dso-highlight';

describe('scaleMatrixForDpr', () => {
  it('multiplies all six coefficients by the device pixel ratio', () => {
    const m = { a: 2, b: 0.5, c: -0.5, d: 3, e: 100, f: 200 };
    expect(scaleMatrixForDpr(m, 2)).toEqual({ a: 4, b: 1, c: -1, d: 6, e: 200, f: 400 });
  });

  it('is a no-op at dpr = 1', () => {
    const m = { a: 1.5, b: 0, c: 0, d: 1.5, e: 10, f: 20 };
    expect(scaleMatrixForDpr(m, 1)).toEqual(m);
  });
});

describe('computeGalleryLayout', () => {
  // A4 portrait in jsPDF "px" units is roughly 595 x 842.
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 28;
  const GAP = 14;
  const COLUMNS = 3;
  const CAPTION_H = 18;

  function layout(count: number) {
    return computeGalleryLayout(count, PAGE_W, PAGE_H, MARGIN, GAP, COLUMNS, CAPTION_H);
  }

  it('derives cell width from page width, margins, gaps and columns', () => {
    const l = layout(12);
    const usableW = PAGE_W - MARGIN * 2;
    const expectedCellW = (usableW - GAP * (COLUMNS - 1)) / COLUMNS;
    expect(l.cellW).toBeCloseTo(expectedCellW);
    expect(l.imgH).toBeCloseTo(expectedCellW * (2 / 3));
    expect(l.cellH).toBeCloseTo(l.imgH + CAPTION_H);
  });

  it('fits a whole number of rows per page', () => {
    const l = layout(100);
    expect(l.rowsPerPage).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(l.rowsPerPage)).toBe(true);
    expect(l.perPage).toBe(l.rowsPerPage * COLUMNS);
  });

  it('paginates: N photos at perPage per page ⇒ ceil(N / perPage) pages', () => {
    const l = layout(0);
    const perPage = l.perPage;
    expect(computeGalleryLayout(perPage, PAGE_W, PAGE_H, MARGIN, GAP, COLUMNS, CAPTION_H).pages).toBe(1);
    expect(computeGalleryLayout(perPage + 1, PAGE_W, PAGE_H, MARGIN, GAP, COLUMNS, CAPTION_H).pages).toBe(2);
    expect(computeGalleryLayout(perPage * 3, PAGE_W, PAGE_H, MARGIN, GAP, COLUMNS, CAPTION_H).pages).toBe(3);
  });

  it('always reports at least one page, even for zero photos', () => {
    expect(layout(0).pages).toBe(1);
  });
});

describe('computeFramedViewScale', () => {
  it('sizes the binding axis so the FOV occupies the requested fraction', () => {
    // Square image, wider-than-tall FOV ⇒ width binds.
    const imgW = 500, imgH = 500, frac = 0.6, dec = 0;
    const scale = computeFramedViewScale(1, 0.5, dec, imgW, imgH, frac);
    const frameWidthPx = 2 * angularSizeToCanvasPxForDSO(1 * 30, dec, scale);
    expect(frameWidthPx).toBeCloseTo(frac * imgW, 3);
    // The shorter (height) axis stays within the fraction.
    const frameHeightPx = 2 * angularSizeToCanvasPxForDSO(0.5 * 30, dec, scale);
    expect(frameHeightPx).toBeLessThanOrEqual(frac * imgH + 1e-6);
  });

  it('is inversely proportional to FOV size (bigger field ⇒ smaller scale)', () => {
    const big = computeFramedViewScale(2, 2, 0, 500, 500, 0.6);
    const small = computeFramedViewScale(1, 1, 0, 500, 500, 0.6);
    expect(big).toBeLessThan(small);
    expect(small / big).toBeCloseTo(2, 1);
  });

  it('returns a positive finite scale for degenerate (zero) dimensions', () => {
    expect(computeFramedViewScale(0, 0, 0, 500, 500, 0.6)).toBe(1);
  });
});
