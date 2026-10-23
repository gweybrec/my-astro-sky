import { describe, expect, it } from 'vitest';
import {
  draftFromPhoto,
  draftToMetadata,
  fillDraftFromWcs,
  filterLabelCandidates,
  isDraftDirty,
  sanitizeIntegrations,
} from '@myastrosky/core/photo-metadata-draft';
import type { Photo, PlateSolveResult } from '@myastrosky/core/types';

const photo = (over: Partial<Photo> = {}): Photo =>
  ({
    id: 'p1',
    originalName: 'M31.jpg',
    dsoIds: ['M31'],
    labels: ['2025'],
    pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'comet' }],
    integrations: [{ frames: 40, seconds: 180, filter: ' L ' }],
    observationDate: '2025-09-14T21:40:00.000Z',
    captureDetails: { gain: 100, unknown: 3 },
    gearSetupId: 's1',
    notes: 'n',
    ...over,
  }) as unknown as Photo;

describe('sanitizeIntegrations', () => {
  it('keeps whole non-negative numbers, zeroes the rest and trims the filter', () => {
    expect(
      sanitizeIntegrations([
        { frames: 10, seconds: 60, filter: ' Ha ' },
        { frames: -2, seconds: 1.5, filter: '' },
      ]),
    ).toEqual([
      { frames: 10, seconds: 60, filter: 'Ha' },
      { frames: 0, seconds: 0, filter: '' },
    ]);
  });
});

describe('draftFromPhoto', () => {
  it('copies the metadata without sharing arrays with the photo', () => {
    const p = photo();
    const draft = draftFromPhoto(p);
    expect(draft).toEqual({
      displayName: 'M31.jpg',
      dsoIds: ['M31'],
      labels: ['2025'],
      pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'comet' }],
      integrations: [{ frames: 40, seconds: 180, filter: 'L' }],
      observationDate: '2025-09-14T21:40:00.000Z',
      captureDetails: { gain: 100 },
      gearSetupId: 's1',
      notes: 'n',
    });
    draft.dsoIds.push('M32');
    draft.pointsOfInterest[0].name = 'x';
    expect(p.dsoIds).toEqual(['M31']);
    expect(p.pointsOfInterest[0].name).toBe('C/2023 A3');
  });

  it('gives empty values for what the photo does not have', () => {
    const draft = draftFromPhoto(
      photo({
        integrations: undefined,
        observationDate: null,
        captureDetails: null,
        gearSetupId: null,
      }),
    );
    expect(draft.integrations).toEqual([]);
    expect(draft.observationDate).toBe('');
    expect(draft.captureDetails).toEqual({});
    expect(draft.gearSetupId).toBeNull();
  });
});

describe('isDraftDirty', () => {
  const original = draftFromPhoto(photo());
  const changed = (change: (d: ReturnType<typeof draftFromPhoto>) => void) => {
    const draft = draftFromPhoto(photo());
    change(draft);
    return isDraftDirty(draft, original);
  };

  it('is clean for an untouched draft, and for a capture field added but left empty', () => {
    expect(changed(() => {})).toBe(false);
    expect(changed((d) => (d.captureDetails = { ...d.captureDetails, iso: '' }))).toBe(false);
  });

  it('sees a change of each part', () => {
    expect(changed((d) => (d.displayName = 'x'))).toBe(true);
    expect(changed((d) => (d.observationDate = ''))).toBe(true);
    expect(changed((d) => (d.gearSetupId = null))).toBe(true);
    expect(changed((d) => (d.captureDetails = { gain: 120 }))).toBe(true);
    expect(changed((d) => (d.notes = ''))).toBe(true);
    expect(changed((d) => d.dsoIds.push('M32'))).toBe(true);
    expect(changed((d) => (d.labels = []))).toBe(true);
    expect(changed((d) => (d.pointsOfInterest = []))).toBe(true);
    expect(changed((d) => (d.pointsOfInterest[0].categoryId = 'asteroid'))).toBe(true);
    expect(changed((d) => d.integrations.push({ frames: 0, seconds: 0, filter: '' }))).toBe(true);
    expect(changed((d) => (d.integrations[0].seconds = 240))).toBe(true);
  });
});

describe('draftToMetadata', () => {
  it('cleans the values and falls back to the current name when the name is emptied', () => {
    const draft = draftFromPhoto(photo());
    draft.displayName = '   ';
    draft.observationDate = '';
    draft.gearSetupId = '';
    draft.captureDetails = { gain: '', iso: 800 };
    draft.integrations = [{ frames: 5, seconds: -1, filter: ' R ' }];
    expect(draftToMetadata(draft, 'M31.jpg')).toEqual({
      dsoIds: ['M31'],
      labels: ['2025'],
      pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'comet' }],
      integrations: [{ frames: 5, seconds: 0, filter: 'R' }],
      observationDate: null,
      captureDetails: { iso: 800 },
      gearSetupId: null,
      notes: 'n',
      originalName: 'M31.jpg',
    });
  });

  it('keeps a typed name, trimmed', () => {
    const draft = draftFromPhoto(photo());
    draft.displayName = ' Andromède ';
    expect(draftToMetadata(draft, 'M31.jpg').originalName).toBe('Andromède');
  });
});

describe('fillDraftFromWcs', () => {
  const result = {
    success: true,
    dateObs: '2024-01-02T03:04:05.000Z',
    expTime: 120.4,
    stackCnt: 30,
    filter: 'Ha',
    captureDetails: { gain: 200, iso: 800 },
  } as unknown as PlateSolveResult;

  it('fills only what the draft does not have', () => {
    const draft = draftFromPhoto(photo());
    draft.captureDetails = { gain: 100, iso: '' };
    const { patch, filled } = fillDraftFromWcs(draft, result);
    expect(patch).toEqual({ captureDetails: { gain: 100, iso: 800 } });
    expect(filled).toBe(1);
  });

  it('fills the date, one integration row and the capture fields of an empty draft', () => {
    const draft = draftFromPhoto(
      photo({ observationDate: null, integrations: [], captureDetails: null }),
    );
    const { patch, filled } = fillDraftFromWcs(draft, result);
    expect(patch).toEqual({
      observationDate: '2024-01-02T03:04:05.000Z',
      integrations: [{ frames: 30, seconds: 120, filter: 'Ha' }],
      captureDetails: { gain: 200, iso: 800 },
    });
    expect(filled).toBe(4);
  });

  it('finds nothing in a file without these headers', () => {
    const draft = draftFromPhoto(photo());
    expect(fillDraftFromWcs(draft, { success: true } as PlateSolveResult)).toEqual({
      patch: {},
      filled: 0,
    });
  });
});

// ─── filterLabelCandidates ────────────────────────────────────────────────────

describe('filterLabelCandidates', () => {
  const KNOWN = ['Widefield', 'Nebula', 'Galaxy', 'Mosaic', 'Ha-only'];

  it('empty query returns all non-excluded labels', () => {
    expect(filterLabelCandidates(KNOWN, [], '')).toEqual(KNOWN);
  });

  it('already-selected labels are excluded from results', () => {
    const results = filterLabelCandidates(KNOWN, ['Galaxy'], '');
    expect(results).not.toContain('Galaxy');
    expect(results).toContain('Nebula');
    expect(results).toContain('Widefield');
  });

  it('multiple exclusions are all removed', () => {
    const results = filterLabelCandidates(KNOWN, ['Galaxy', 'Mosaic'], '');
    expect(results).not.toContain('Galaxy');
    expect(results).not.toContain('Mosaic');
  });

  it('query filters by substring (case-insensitive)', () => {
    // 'gal' matches 'Galaxy'; does not match Widefield, Nebula, Mosaic, Ha-only
    const results = filterLabelCandidates(KNOWN, [], 'gal');
    expect(results).toContain('Galaxy');
    expect(results).not.toContain('Widefield');
    expect(results).not.toContain('Nebula');
    expect(results).not.toContain('Mosaic');
    expect(results).not.toContain('Ha-only');
  });

  it('query matching is case-insensitive on both sides', () => {
    expect(filterLabelCandidates(KNOWN, [], 'NEBULA')).toContain('Nebula');
    expect(filterLabelCandidates(KNOWN, [], 'galaxy')).toContain('Galaxy');
  });

  it('exclusion and query work together', () => {
    // 'Galaxy' matches 'la' but is excluded
    const results = filterLabelCandidates(KNOWN, ['Galaxy'], 'la');
    expect(results).not.toContain('Galaxy');
  });

  it('whitespace-only query is treated as empty (show all)', () => {
    expect(filterLabelCandidates(KNOWN, [], '   ')).toEqual(KNOWN);
  });

  it('query with no match returns empty array', () => {
    expect(filterLabelCandidates(KNOWN, [], 'zxcv')).toHaveLength(0);
  });

  it('capped at maxResults (default 8)', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Label${i}`);
    expect(filterLabelCandidates(many, [], '')).toHaveLength(8);
  });

  it('explicit maxResults is respected', () => {
    expect(filterLabelCandidates(KNOWN, [], '', 2)).toHaveLength(2);
  });

  it('empty known labels always returns empty array', () => {
    expect(filterLabelCandidates([], [], '')).toHaveLength(0);
    expect(filterLabelCandidates([], [], 'ha')).toHaveLength(0);
  });

  it('newly typed label appears in next query after being added to knownLabels', () => {
    const known = ['Widefield', 'Nebula'];
    known.push('Ha-mosaic'); // simulates commitLabel adding to localKnownLabels
    const results = filterLabelCandidates(known, [], 'ha');
    expect(results).toContain('Ha-mosaic');
  });
});
