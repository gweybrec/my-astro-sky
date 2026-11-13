/**
 * What the shared-sky screens decide apart from any screen: the "skies shown" choices, the confirmation of a package,
 * a visited photo's read-only rows, and which dropped file is a package.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  keepKnownSkies,
  MY_SKY,
  rememberedSkiesShown,
  sharedSkyLacksRoom,
  sharedSkyPreviewKeys,
  skyChoiceOptions,
} from '@myastrosky/core/shared-sky-view';
import type { SharedSky, SharedSkyPreview } from '@myastrosky/core/domain/shared-sky';
import { setLang } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import {
  isSharedSkyFileName,
  sharedSkyFileOf,
  takeDroppedSharedSky,
  holdDroppedSharedSky,
} from '../../src/shared-sky-drop';
import { visitPhotoInfoRows } from '../../src/visit-photo-info';

const sky = (id: string, senderName: string) => ({ id, senderName }) as SharedSky;
const SKIES = [sky('sky-paul-1', 'Paul'), sky('sky-zoe-01', 'Zoe')];

describe('the skies shown', () => {
  it('offers the user own sky, then each visited sky under its sender name', () => {
    expect(skyChoiceOptions(SKIES)).toEqual([
      { value: MY_SKY, labelKey: 'sharedSky.viewMine' },
      { value: 'sky-paul-1', label: 'Paul' },
      { value: 'sky-zoe-01', label: 'Zoe' },
    ]);
    expect(skyChoiceOptions([])).toHaveLength(1);
  });

  it('keeps the skies that exist, once each, in the list order', () => {
    expect(keepKnownSkies(['sky-zoe-01', 'gone', MY_SKY, 'sky-zoe-01'], SKIES)).toEqual([
      MY_SKY,
      'sky-zoe-01',
    ]);
    expect(keepKnownSkies([], SKIES)).toEqual([]);
  });

  it('reads back what was remembered, and the earlier single choice', () => {
    expect(rememberedSkiesShown({ shown: ['sky-paul-1'] }, SKIES)).toEqual(['sky-paul-1']);
    expect(rememberedSkiesShown({ shown: [] }, SKIES)).toEqual([]);
    expect(rememberedSkiesShown({ mode: 'visit', skyId: 'sky-zoe-01' }, SKIES)).toEqual([
      'sky-zoe-01',
    ]);
    expect(rememberedSkiesShown({ mode: 'both', skyId: 'sky-zoe-01' }, SKIES)).toEqual([
      MY_SKY,
      'sky-zoe-01',
    ]);
    for (const bad of [null, 'x', 3, { mode: 'mine' }, {}]) {
      expect(rememberedSkiesShown(bad, SKIES)).toEqual([MY_SKY]);
    }
  });
});

describe('the confirmation of a package', () => {
  const preview = (over: Partial<SharedSkyPreview>): SharedSkyPreview => ({
    skyId: 'sky-12345678',
    senderName: 'Paul',
    sharedAt: '2026-03-01T10:00:00.000Z',
    photoCount: 2,
    bytes: 1000,
    status: 'new',
    freeBytes: null,
    ...over,
  });

  it('asks to open, to update or to go back, by how the package stands', () => {
    expect(sharedSkyPreviewKeys('new')).toEqual({
      message: 'sharedSky.previewNew',
      confirm: 'sharedSky.openConfirm',
    });
    expect(sharedSkyPreviewKeys('update').confirm).toBe('sharedSky.updateConfirm');
    expect(sharedSkyPreviewKeys('same').confirm).toBe('sharedSky.openConfirm');
    expect(sharedSkyPreviewKeys('older').confirm).toBe('sharedSky.olderConfirm');
  });

  it('refuses a package only when the room left is known and too small', () => {
    expect(sharedSkyLacksRoom(preview({ freeBytes: null }))).toBe(false);
    expect(sharedSkyLacksRoom(preview({ freeBytes: 1049 }))).toBe(true);
    expect(sharedSkyLacksRoom(preview({ freeBytes: 1050 }))).toBe(false);
  });
});

describe('a visited photo read-only rows', () => {
  beforeAll(() => setLang('en'));

  const photo = (over: Partial<Photo>): Photo =>
    ({ id: 'p', notes: '', integrations: [], captureDetails: {}, ...over }) as Photo;

  it('leaves out what the photo does not say', () => {
    expect(visitPhotoInfoRows(photo({}))).toEqual([]);
  });

  it('writes the exposures, the date, the gear, the capture details and the notes, in the editor order', () => {
    const rows = visitPhotoInfoRows(
      photo({
        integrations: [
          { frames: 120, seconds: 180, filter: 'Ha' },
          { frames: 0, seconds: 60, filter: '' },
        ],
        observationDate: '2026-01-02T20:00:00.000Z',
        sharedGear: { setup: 'Travel', telescope: 'Sky 80ED', camera: 'ZWO ASI533' },
        captureDetails: { gain: 100, ccdTemp: -10, unknownField: 3 },
        notes: '  Clear night  ',
      }),
      'en-GB',
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].lines[0]).toMatch(/^120 × 180\S* = 6h00, Ha$/);
    expect(rows[0].lines[1]).toMatch(/× 60/);
    expect(rows[0].lines[1]).not.toContain('=');
    expect(rows[1].lines[0]).toContain('2026');
    expect(rows[2].lines).toEqual(['Travel', 'Telescope : Sky 80ED', 'Camera : ZWO ASI533']);
    expect(rows[3].lines).toHaveLength(2);
    expect(rows[3].lines[1]).toMatch(/: -10 °C$/);
    expect(rows[4].lines).toEqual(['Clear night']);
  });

  it('puts the author first, on a line of its own', () => {
    const rows = visitPhotoInfoRows(photo({ author: 'Paul', notes: 'Clear' }));
    expect(rows.map((r) => [r.label, r.lines, r.oneLine ?? false])).toEqual([
      ['Author', ['Paul'], true],
      ['Notes', ['Clear'], false],
    ]);
  });

  it('leaves out a date that cannot be read', () => {
    expect(visitPhotoInfoRows(photo({ observationDate: 'not a date' }))).toEqual([]);
  });
});

describe('a dropped package', () => {
  it('is told by its name, whatever its case', () => {
    expect(isSharedSkyFileName('Paul.myastrosky')).toBe(true);
    expect(isSharedSkyFileName('PAUL.MYASTROSKY')).toBe(true);
    expect(isSharedSkyFileName('backup.zip')).toBe(false);
    expect(isSharedSkyFileName('M42.jpg')).toBe(false);
  });

  it('is picked among the files of a drop, and handed over once', () => {
    const photo = new File(['x'], 'M42.jpg');
    const pkg = new File(['x'], 'Paul.myastrosky');
    expect(sharedSkyFileOf([photo])).toBeNull();
    expect(sharedSkyFileOf(null)).toBeNull();
    expect(sharedSkyFileOf([photo, pkg])).toBe(pkg);
    expect(takeDroppedSharedSky()).toBeNull();
    holdDroppedSharedSky(pkg);
    expect(takeDroppedSharedSky()).toBe(pkg);
    expect(takeDroppedSharedSky()).toBeNull();
  });
});
