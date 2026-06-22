import { describe, it, expect, beforeEach } from 'vitest';
import {
  SHORTCUT_ACTIONS,
  normalizeKey,
  formatKey,
  defaultBindings,
  mergeBindings,
  reverseMap,
  findConflicts,
  assignKey,
  resetBinding,
  loadBindings,
  saveBindings,
  importBindings,
  SHORTCUTS_KEY,
} from '../../src/keyboard-shortcuts';

describe('normalizeKey', () => {
  it('lowercases plain letters', () => {
    expect(normalizeKey({ key: 's' })).toBe('s');
    expect(normalizeKey({ key: 'C' })).toBe('c');
  });

  it('encodes shift only for letters', () => {
    expect(normalizeKey({ key: 'S', shiftKey: true })).toBe('shift+s');
    expect(normalizeKey({ key: 'D', shiftKey: true })).toBe('shift+d');
  });

  it('does not encode shift for punctuation (already in the produced char)', () => {
    expect(normalizeKey({ key: '+', shiftKey: true })).toBe('+');
    expect(normalizeKey({ key: '=' })).toBe('=');
    expect(normalizeKey({ key: '-' })).toBe('-');
    expect(normalizeKey({ key: '?', shiftKey: true })).toBe('?');
  });

  it('lowercases named keys like arrows', () => {
    expect(normalizeKey({ key: 'ArrowLeft' })).toBe('arrowleft');
    expect(normalizeKey({ key: 'ArrowDown' })).toBe('arrowdown');
  });

  it('orders modifiers deterministically', () => {
    expect(normalizeKey({ key: 'K', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+k');
  });

  it('returns empty string for bare modifier presses', () => {
    expect(normalizeKey({ key: 'Shift', shiftKey: true })).toBe('');
    expect(normalizeKey({ key: 'Control', ctrlKey: true })).toBe('');
  });
});

describe('formatKey', () => {
  it('renders single keys and modifiers', () => {
    expect(formatKey('s')).toBe('S');
    expect(formatKey('shift+d')).toBe('Shift + D');
    expect(formatKey('arrowleft')).toBe('←');
    expect(formatKey('+')).toBe('+');
    expect(formatKey('')).toBe('');
  });
});

describe('defaults & merge', () => {
  it('defaultBindings covers every registered action', () => {
    const b = defaultBindings();
    for (const a of SHORTCUT_ACTIONS) expect(b[a.id]).toEqual(a.defaultKeys);
  });

  it('defaults have no conflicts', () => {
    expect(findConflicts(defaultBindings()).size).toBe(0);
  });

  it('mergeBindings overlays valid stored entries onto defaults', () => {
    const merged = mergeBindings({ toggleStars: ['x'], bogus: ['z'] });
    expect(merged.toggleStars).toEqual(['x']);
    expect(merged.toggleGrid).toEqual(['e']); // untouched default
    expect('bogus' in merged).toBe(false);
  });

  it('mergeBindings ignores malformed entries', () => {
    const merged = mergeBindings({ toggleStars: 'notarray', toggleDSOs: [1, 2] });
    expect(merged.toggleStars).toEqual(['s']);
    expect(merged.toggleDSOs).toEqual(['d']);
  });

  it('mergeBindings handles junk input', () => {
    expect(mergeBindings(null)).toEqual(defaultBindings());
    expect(mergeBindings('nope')).toEqual(defaultBindings());
  });
});

describe('reverseMap & conflicts', () => {
  it('maps keys to their action ids', () => {
    const m = reverseMap(defaultBindings());
    expect(m.get('s')).toEqual(['toggleStars']);
    expect(m.get('e')).toEqual(['toggleGrid']);
    // zoomIn binds both + and =
    expect(m.get('+')).toEqual(['zoomIn']);
    expect(m.get('=')).toEqual(['zoomIn']);
  });

  it('detects a conflict when two actions share a key', () => {
    const b = defaultBindings();
    b.toggleStars = ['c']; // collide with toggleConstellationLines
    const conflicts = findConflicts(b);
    expect(conflicts.has('toggleStars')).toBe(true);
    expect(conflicts.has('toggleConstellationLines')).toBe(true);
  });
});

describe('assignKey (allows duplicates) & resetBinding', () => {
  it('assigns a key without stealing it from the previous owner', () => {
    const b = defaultBindings();
    const next = assignKey(b, 'toggleStars', 'c'); // 'c' is still constellation lines
    expect(next.toggleStars).toEqual(['c']);
    expect(next.toggleConstellationLines).toEqual(['c']); // kept — duplicate allowed
    // both actions now share 'c', surfaced as a conflict
    const conflicts = findConflicts(next);
    expect(conflicts.has('toggleStars')).toBe(true);
    expect(conflicts.has('toggleConstellationLines')).toBe(true);
    // original untouched (immutability)
    expect(b.toggleStars).toEqual(['s']);
  });

  it('assigning a non-colliding key produces no conflict', () => {
    const next = assignKey(defaultBindings(), 'toggleStars', 'z');
    expect(next.toggleStars).toEqual(['z']);
    expect(findConflicts(next).size).toBe(0);
  });

  it('resetBinding restores a single action default', () => {
    let b = assignKey(defaultBindings(), 'toggleStars', 'z');
    b = resetBinding(b, 'toggleStars');
    expect(b.toggleStars).toEqual(['s']);
  });
});

describe('importBindings', () => {
  it('imports a raw bindings map (how shortcuts.json is stored in a backup)', () => {
    const round = importBindings({ toggleGrid: ['q'] });
    expect(round.toggleGrid).toEqual(['q']);
    expect(round.toggleStars).toEqual(['s']); // untouched default
  });

  it('also accepts a { bindings: … } envelope', () => {
    const round = importBindings({ bindings: { toggleGrid: ['q'] } });
    expect(round.toggleGrid).toEqual(['q']);
  });

  it('falls back to defaults for junk', () => {
    expect(importBindings(null)).toEqual(defaultBindings());
  });
});

describe('localStorage persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing stored', () => {
    expect(loadBindings()).toEqual(defaultBindings());
  });

  it('round-trips through save/load', () => {
    const b = assignKey(defaultBindings(), 'togglePhotos', 'q');
    saveBindings(b);
    expect(localStorage.getItem(SHORTCUTS_KEY)).toContain('q');
    expect(loadBindings().togglePhotos).toEqual(['q']);
  });

  it('falls back to defaults on corrupt storage', () => {
    localStorage.setItem(SHORTCUTS_KEY, '{not json');
    expect(loadBindings()).toEqual(defaultBindings());
  });
});
