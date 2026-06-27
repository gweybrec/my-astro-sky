import { describe, it, expect } from 'vitest';
import { selectDSOsToRender, type SelectableDSO } from '../../src/dso-selection';

const mk = (id: string, priority: number, isHighlighted = false): SelectableDSO =>
  ({ id, priority, isHighlighted });

describe('selectDSOsToRender()', () => {
  it('keeps every candidate below the priority threshold', () => {
    const candidates = [mk('a', 30), mk('b', 10), mk('c', 20), mk('d', 5)];
    const out = selectDSOsToRender(candidates, 21).map(c => c.id);
    expect(out).toEqual(['b', 'c', 'd']); // 10, 20, 5 are < 21; 30 is not
  });

  it('preserves input order (no sort)', () => {
    const candidates = [mk('a', 3), mk('b', 1), mk('c', 2), mk('d', 0)];
    const out = selectDSOsToRender(candidates, 100).map(c => c.id);
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('threshold is exclusive (priority === threshold is dropped)', () => {
    const candidates = [mk('a', 4), mk('b', 5)];
    const out = selectDSOsToRender(candidates, 5).map(c => c.id);
    expect(out).toEqual(['a']);
  });

  it('always keeps the highlighted candidate even above the threshold', () => {
    const candidates = [mk('a', 1), mk('b', 2), mk('hi', 9999, true)];
    const out = selectDSOsToRender(candidates, 3).map(c => c.id);
    expect(out).toContain('hi');
    expect(out).toEqual(['a', 'b', 'hi']); // order preserved, highlighted kept
  });

  it('is per-candidate: inclusion does not depend on other candidates', () => {
    const dense = [mk('a', 1), mk('b', 2), mk('c', 3), mk('d', 4), mk('e', 5)];
    const sparse = [mk('a', 1), mk('b', 2)];
    const inDense = selectDSOsToRender(dense, 3).map(c => c.id);
    const inSparse = selectDSOsToRender(sparse, 3).map(c => c.id);
    // 'a' and 'b' render in both regardless of how crowded the candidate set is.
    expect(inDense).toContain('a');
    expect(inDense).toContain('b');
    expect(inSparse).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const candidates = [mk('a', 3), mk('b', 1), mk('c', 2)];
    const before = candidates.map(c => c.id);
    selectDSOsToRender(candidates, 2);
    expect(candidates.map(c => c.id)).toEqual(before);
  });

  it('preserves caller-attached payload on the selected items', () => {
    type Rich = SelectableDSO & { dso: { id: string } };
    const candidates: Rich[] = [
      { id: 'a', priority: 5, isHighlighted: false, dso: { id: 'a' } },
      { id: 'b', priority: 1, isHighlighted: false, dso: { id: 'b' } },
    ];
    const out = selectDSOsToRender(candidates, 3);
    expect(out[0].dso.id).toBe('b');
  });
});
