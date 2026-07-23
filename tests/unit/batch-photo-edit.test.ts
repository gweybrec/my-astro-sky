import { describe, it, expect } from 'vitest';
import {
  SETUP_NO_CHANGE,
  applyBatchEdit,
  buildMetadataPayload,
  collectBatchEdits,
  draftFromPhoto,
  type PhotoEditDraft,
} from '../../src/batch-photo-edit';
import type { Photo } from '../../src/types';

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    filename: 'p1.jpg',
    originalName: 'M31.jpg',
    width: 4000,
    height: 3000,
    createdAt: '2024-01-01T00:00:00.000Z',
    correspondences: [],
    dsoIds: ['M31'],
    labels: ['winter'],
    pointsOfInterest: [],
    integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
    observationDate: '2024-01-02T00:00:00.000Z',
    captureDetails: { gain: 100 },
    gearSetupId: null,
    notes: 'my notes',
    ...overrides,
  };
}

function drafts(...entries: [string, PhotoEditDraft][]): Map<string, PhotoEditDraft> {
  return new Map(entries);
}

const NO_PENDING = { labels: [], setupId: SETUP_NO_CHANGE };

describe('collectBatchEdits — label mode', () => {
  it('merges the pending labels into a checked photo without removing existing ones', () => {
    const photo = makePhoto({ labels: ['winter', 'ha'] });
    const edits = collectBatchEdits('label', [photo], new Map(), new Set(['p1']), {
      labels: ['bortle4'],
      setupId: SETUP_NO_CHANGE,
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].labels).toEqual(['winter', 'ha', 'bortle4']);
  });

  it('dedups a pending label the photo already carries (no change → no edit)', () => {
    const photo = makePhoto({ labels: ['winter'] });
    const edits = collectBatchEdits('label', [photo], new Map(), new Set(['p1']), {
      labels: ['winter'],
      setupId: SETUP_NO_CHANGE,
    });
    expect(edits).toEqual([]);
  });

  it('leaves unchecked photos on their row draft', () => {
    const photo = makePhoto({ labels: ['winter'] });
    const edits = collectBatchEdits(
      'label',
      [photo],
      drafts(['p1', { labels: ['winter', 'moon'], gearSetupId: null }]),
      new Set(),
      { labels: ['bortle4'], setupId: SETUP_NO_CHANGE },
    );
    expect(edits).toHaveLength(1);
    expect(edits[0].labels).toEqual(['winter', 'moon']);
  });

  it('saves an individual row edit even when the photo is not checked', () => {
    const photo = makePhoto({ labels: [] });
    const edits = collectBatchEdits(
      'label',
      [photo],
      drafts(['p1', { labels: ['nebula'], gearSetupId: null }]),
      new Set(),
      NO_PENDING,
    );
    expect(edits.map((e) => e.labels)).toEqual([['nebula']]);
  });

  it('combines a row edit with the pending labels when checked', () => {
    const photo = makePhoto({ labels: ['winter'] });
    const edits = collectBatchEdits(
      'label',
      [photo],
      drafts(['p1', { labels: ['winter', 'moon'], gearSetupId: null }]),
      new Set(['p1']),
      { labels: ['moon', 'bortle4'], setupId: SETUP_NO_CHANGE },
    );
    expect(edits[0].labels).toEqual(['winter', 'moon', 'bortle4']);
  });

  it('detects a label removal made on the row', () => {
    const photo = makePhoto({ labels: ['winter', 'ha'] });
    const edits = collectBatchEdits(
      'label',
      [photo],
      drafts(['p1', { labels: ['ha'], gearSetupId: null }]),
      new Set(),
      NO_PENDING,
    );
    expect(edits[0].labels).toEqual(['ha']);
  });

  it('returns nothing when no photo differs', () => {
    const photos = [makePhoto(), makePhoto({ id: 'p2', labels: [] })];
    expect(
      collectBatchEdits('label', photos, new Map(), new Set(['p1', 'p2']), NO_PENDING),
    ).toEqual([]);
  });
});

describe('collectBatchEdits — setup mode', () => {
  it('applies the pending setup to checked photos only', () => {
    const photos = [makePhoto(), makePhoto({ id: 'p2' })];
    const edits = collectBatchEdits('setup', photos, new Map(), new Set(['p2']), {
      labels: [],
      setupId: 'setup-a',
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].photo.id).toBe('p2');
    expect(edits[0].gearSetupId).toBe('setup-a');
  });

  it('treats SETUP_NO_CHANGE as a no-op even for checked photos', () => {
    const photo = makePhoto({ gearSetupId: 'setup-a' });
    expect(collectBatchEdits('setup', [photo], new Map(), new Set(['p1']), NO_PENDING)).toEqual([]);
  });

  it('clears the link when the pending setup is the empty (no setup) option', () => {
    const photo = makePhoto({ gearSetupId: 'setup-a' });
    const edits = collectBatchEdits('setup', [photo], new Map(), new Set(['p1']), {
      labels: [],
      setupId: '',
    });
    expect(edits[0].gearSetupId).toBeNull();
  });

  it('keeps an individual row setup for an unchecked photo', () => {
    const photo = makePhoto();
    const edits = collectBatchEdits(
      'setup',
      [photo],
      drafts(['p1', { labels: ['winter'], gearSetupId: 'setup-b' }]),
      new Set(),
      { labels: [], setupId: 'setup-a' },
    );
    expect(edits[0].gearSetupId).toBe('setup-b');
  });

  it('ignores label drafts in setup mode', () => {
    const photo = makePhoto({ labels: ['winter'] });
    const edits = collectBatchEdits(
      'setup',
      [photo],
      drafts(['p1', { labels: ['whatever'], gearSetupId: null }]),
      new Set(),
      NO_PENDING,
    );
    expect(edits).toEqual([]);
  });
});

describe('draftFromPhoto', () => {
  it('copies labels (not by reference) and normalises a missing setup to null', () => {
    const photo = makePhoto({ gearSetupId: undefined });
    const draft = draftFromPhoto(photo);
    draft.labels.push('mutated');
    expect(photo.labels).toEqual(['winter']);
    expect(draft.gearSetupId).toBeNull();
  });
});

describe('buildMetadataPayload', () => {
  it('carries every existing metadata field through (the PATCH route replaces, not merges)', () => {
    const photo = makePhoto();
    const payload = buildMetadataPayload(photo, { labels: ['winter', 'bortle4'] });
    expect(payload).toEqual({
      dsoIds: ['M31'],
      labels: ['winter', 'bortle4'],
      pointsOfInterest: [],
      integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
      observationDate: '2024-01-02T00:00:00.000Z',
      captureDetails: { gain: 100 },
      gearSetupId: null,
      notes: 'my notes',
      originalName: 'M31.jpg',
    });
  });

  it('keeps the photo values when no override is given', () => {
    const photo = makePhoto({ gearSetupId: 'setup-a' });
    const payload = buildMetadataPayload(photo);
    expect(payload.labels).toEqual(['winter']);
    expect(payload.gearSetupId).toBe('setup-a');
  });

  it('applies an explicit null setup override', () => {
    const payload = buildMetadataPayload(makePhoto({ gearSetupId: 'setup-a' }), {
      gearSetupId: null,
    });
    expect(payload.gearSetupId).toBeNull();
  });

  it('defaults optional collections that are absent on the photo', () => {
    const photo = makePhoto({ integrations: undefined, observationDate: undefined });
    const payload = buildMetadataPayload(photo);
    expect(payload.integrations).toEqual([]);
    expect(payload.observationDate).toBeNull();
  });
});

describe('applyBatchEdit', () => {
  it('produces a new Photo with the resolved values', () => {
    const photo = makePhoto();
    const updated = applyBatchEdit({ photo, labels: ['a'], gearSetupId: 'setup-a' });
    expect(updated).not.toBe(photo);
    expect(updated.labels).toEqual(['a']);
    expect(updated.gearSetupId).toBe('setup-a');
    expect(updated.notes).toBe('my notes');
  });
});
