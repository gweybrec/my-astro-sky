import { describe, it, expect } from 'vitest';
import { selectDSOsToRender, type SelectableDSO } from '../../src/dso-selection';

const mk = (id: string, priority: number, isHighlighted = false): SelectableDSO =>
  ({ id, priority, isHighlighted });

describe('selectDSOsToRender()', () => {
  it('returns all candidates unchanged when within budget (short-circuit)', () => {
    const candidates = [mk('a', 3), mk('b', 1), mk('c', 2)];
    const out = selectDSOsToRender(candidates, 5);
    expect(out).toBe(candidates); // same array reference, unsorted
  });

  it('keeps the lowest-priority candidates up to maxCount', () => {
    const candidates = [mk('a', 30), mk('b', 10), mk('c', 20), mk('d', 5)];
    const out = selectDSOsToRender(candidates, 2).map(c => c.id);
    expect(out).toEqual(['d', 'b']); // priority 5 then 10
  });

  it('always keeps the highlighted candidate even with a high priority and tight budget', () => {
    const candidates = [
      mk('a', 1), mk('b', 2), mk('c', 3),
      mk('hi', 9999, true), // worst priority, but highlighted
    ];
    const out = selectDSOsToRender(candidates, 2).map(c => c.id);
    expect(out).toContain('hi');
    expect(out.length).toBe(2);
    expect(out[0]).toBe('hi'); // pinned first
  });

  it('does not mutate the input array order', () => {
    const candidates = [mk('a', 3), mk('b', 1), mk('c', 2), mk('d', 0)];
    const before = candidates.map(c => c.id);
    selectDSOsToRender(candidates, 2);
    expect(candidates.map(c => c.id)).toEqual(before);
  });

  it('preserves caller-attached payload on the selected items', () => {
    type Rich = SelectableDSO & { dso: { id: string } };
    const candidates: Rich[] = [
      { id: 'a', priority: 5, isHighlighted: false, dso: { id: 'a' } },
      { id: 'b', priority: 1, isHighlighted: false, dso: { id: 'b' } },
      { id: 'c', priority: 9, isHighlighted: false, dso: { id: 'c' } },
    ];
    const out = selectDSOsToRender(candidates, 1);
    expect(out[0].dso.id).toBe('b');
  });
});
