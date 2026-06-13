import { describe, it, expect } from 'vitest';
import { diffSeenDumps } from '../../electron/crash-seen';

describe('diffSeenDumps', () => {
  it('reports all dumps as new when nothing was seen before', () => {
    const r = diffSeenDumps(['a.dmp', 'b.dmp'], []);
    expect(r.newDumps).toEqual(['a.dmp', 'b.dmp']);
    expect(r.updatedSeen.sort()).toEqual(['a.dmp', 'b.dmp']);
  });

  it('reports nothing new when all dumps were already seen', () => {
    const r = diffSeenDumps(['a.dmp', 'b.dmp'], ['a.dmp', 'b.dmp']);
    expect(r.newDumps).toEqual([]);
    expect(r.updatedSeen.sort()).toEqual(['a.dmp', 'b.dmp']);
  });

  it('reports only the dumps not previously seen', () => {
    const r = diffSeenDumps(['a.dmp', 'b.dmp', 'c.dmp'], ['a.dmp']);
    expect(r.newDumps).toEqual(['b.dmp', 'c.dmp']);
    expect(r.updatedSeen.sort()).toEqual(['a.dmp', 'b.dmp', 'c.dmp']);
  });

  it('prunes seen entries for dumps that no longer exist on disk', () => {
    // 'old.dmp' was seen but is gone now; it should not linger in the marker.
    const r = diffSeenDumps(['a.dmp'], ['a.dmp', 'old.dmp']);
    expect(r.newDumps).toEqual([]);
    expect(r.updatedSeen).toEqual(['a.dmp']);
  });

  it('handles an empty current dump set', () => {
    const r = diffSeenDumps([], ['a.dmp']);
    expect(r.newDumps).toEqual([]);
    expect(r.updatedSeen).toEqual([]);
  });
});
