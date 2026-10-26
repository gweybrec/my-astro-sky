// @vitest-environment node
/**
 * The backup service (WP2.8): export, preview and import, on both SQL adapters, with the archive and the
 * blob store in memory. The routes themselves are pinned by `server-backup.test.ts`.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { backupFileName, type ImportOptions } from '@myastrosky/core/domain/backup';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBackupService, type BackupFile } from '@myastrosky/core/services/backup';
import { createServices } from '@myastrosky/core/services/create-services';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { fakeImageCodec, memoryBlobStore } from '../helpers/fake-image-io';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const json = (v: unknown): Uint8Array => text(JSON.stringify(v));
const parse = (b: Uint8Array | undefined): any => JSON.parse(new TextDecoder().decode(b));

/** A writer that keeps the files in the order they were added. */
function memoryWriter(): BundleWriter & { files: [string, Uint8Array][] } {
  const files: [string, Uint8Array][] = [];
  return {
    files,
    async add(name, bytes) {
      files.push([name, bytes]);
    },
  };
}

/** A reader over a list of files, in order. */
function memoryReader(files: readonly [string, Uint8Array | string][]): BundleReader {
  const bytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? text(v) : v);
  const find = (name: string) => files.find(([n]) => n === name);
  return {
    async names() {
      return files.map(([n]) => n);
    },
    async read(name) {
      const f = find(name);
      return f ? bytes(f[1]) : null;
    },
    async size(name) {
      const f = find(name);
      return f ? bytes(f[1]).byteLength : null;
    },
  };
}

const everything: ImportOptions = {
  importMetadata: true,
  importDsoOverrides: true,
  importPoiCategories: true,
  importSkyRegions: true,
  selectedImages: null,
  selectedPlans: null,
  selectedSetups: null,
  selectedGear: null,
};

const correspondences = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    pointIndex: i,
    photoX: i,
    photoY: i + 1,
    starHip: 1000 + i,
    starName: `Star ${i}`,
  }));

describe.each(SQL_ADAPTERS)('backup service on the %s adapter', (_name, wrap) => {
  let opened: Database.Database[] = [];

  async function makeSet(wrapDb: (db: SqlDb) => SqlDb = (db) => db) {
    const raw = new Database(':memory:');
    opened.push(raw);
    const base = wrap(createBetterSqliteDb(raw));
    await initSchema(base);
    const db = wrapDb(base);
    const blobs = memoryBlobStore();
    const images = fakeImageCodec();
    let n = 0;
    const services = createServices({
      db,
      newId: () => `gen-${++n}`,
      secrets: {
        canEncrypt: () => false,
        encrypt: async (s) => s,
        decrypt: async (s) => s,
        isEncrypted: () => false,
      },
      env: () => undefined,
      platform: { isWindows: false },
      gearCatalog: { telescopes: [], cameras: [], accessories: [], filters: [] },
      images,
      blobs,
      stars: [],
      catalogStars: [],
      http: async () => {
        throw new Error('no network in this test');
      },
      now: () => 0,
    });
    return { ...services, blobs, images };
  }

  beforeEach(() => {
    opened = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of opened) d.close();
  });

  /** A seeded machine: two photos (one with a thumbnail), a plan with a setup, gear, a region, a category, an override. */
  async function seed() {
    const a = await makeSet();
    await a.photos.insert({
      id: 'p1',
      filename: 'p1.jpg',
      thumbFilename: 'thumb_p1.jpg',
      originalName: 'M31.jpg',
      width: 100,
      height: 50,
      correspondences: correspondences(3),
      notes: 'first',
    });
    await a.photos.insert({
      id: 'p2',
      filename: 'p2.jpg',
      originalName: 'M42.jpg',
      width: 100,
      height: 50,
      correspondences: correspondences(2),
    });
    a.blobs.store.set('p1.jpg', text('image-1'));
    a.blobs.store.set('thumb_p1.jpg', text('thumb-1'));
    a.blobs.store.set('p2.jpg', text('image-2'));
    await a.gear.importCustom({ id: 'custom-t1', type: 'telescope', data: { name: 'Tele' } }, []);
    await a.gear.importCustom({ id: 'custom-c1', type: 'camera', data: { name: 'Cam' } }, []);
    await a.gear.importSetup(
      {
        id: 'setup-1',
        name: 'Rig',
        telescopeId: 'custom-t1',
        cameraId: 'custom-c1',
        accessoryId: null,
        enabled: true,
      },
      [],
    );
    const plan = await a.plans.create({ name: 'Night 1' });
    await a.plans.addEntry(plan.id, { dsoId: 'M31' });
    await a.plans.addEntry(plan.id, { ra: 10, dec: 20 });
    await a.plans.update(plan.id, { setupId: 'setup-1' });
    await a.skyRegions.importOne({
      id: 'r1',
      name: 'Zone',
      color: '#123456',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      position: 0,
    });
    await a.poiCategories.importOne({ id: 'cat-1', name: 'Peak', color: '#abcdef', position: 0 });
    await a.dsoOverrides.upsert('M31', { name: 'Andromeda' });
    return a;
  }

  const allOptions = {
    includeImages: true,
    includeMetadata: true,
    includeDsoOverrides: true,
    includeCustomGear: true,
    includeSetups: true,
    includePlans: true,
    includeShortcuts: true,
    includePoiCategories: true,
    includeSkyRegions: true,
  };

  async function exportAll(a: Awaited<ReturnType<typeof seed>>, extra = {}) {
    const writer = memoryWriter();
    await createBackupService({ ...a, newId: () => 'x' }).exportTo(writer, {
      options: allOptions,
      shortcuts: { zoomIn: '+' },
      ...extra,
    });
    return writer;
  }

  describe('exportTo', () => {
    it('writes the manifest, the images, then each ticked file, in a fixed order', async () => {
      const a = await seed();
      const writer = await exportAll(a);
      expect(writer.files.map(([n]) => n)).toEqual([
        'manifest.json',
        'images/p1.jpg',
        'images/thumb_p1.jpg',
        'images/p2.jpg',
        'dso-overrides.json',
        'custom-gear.json',
        'gear-setups.json',
        'poi-categories.json',
        'sky-regions.json',
        'plans.json',
        'shortcuts.json',
      ]);
      const manifest = parse(writer.files[0][1]);
      expect(manifest.manifestVersion).toBe(1);
      expect(manifest.photos.map((p: any) => p.id)).toEqual(['p1', 'p2']);
      expect(new TextDecoder().decode(writer.files[1][1])).toBe('image-1');
      expect(parse(writer.files[4][1])).toEqual({ M31: { name: 'Andromeda' } });
      expect(parse(writer.files[10][1])).toEqual({ zoomIn: '+' });
    });

    it('takes images and metadata by default and nothing else', async () => {
      const a = await seed();
      const writer = memoryWriter();
      await createBackupService({ ...a, newId: () => 'x' }).exportTo(writer, {});
      expect(writer.files.map(([n]) => n)).toEqual([
        'manifest.json',
        'images/p1.jpg',
        'images/thumb_p1.jpg',
        'images/p2.jpg',
      ]);
    });

    it('leaves out images, metadata and the shortcuts that were not asked for or are not an object', async () => {
      const a = await seed();
      const writer = memoryWriter();
      await createBackupService({ ...a, newId: () => 'x' }).exportTo(writer, {
        options: { includeImages: false, includeMetadata: false, includeShortcuts: true },
        shortcuts: 'no',
      });
      expect(writer.files).toEqual([]);
    });

    it('takes only the photos of `ids`, and skips an image that is missing', async () => {
      const a = await seed();
      a.blobs.store.delete('thumb_p1.jpg');
      const writer = await exportAll(a, { ids: ['p1'] });
      expect(writer.files.map(([n]) => n).slice(0, 2)).toEqual(['manifest.json', 'images/p1.jpg']);
      expect(parse(writer.files[0][1]).photos).toHaveLength(1);
      expect(writer.files.some(([n]) => n === 'images/p2.jpg')).toBe(false);
      expect(writer.files.some(([n]) => n === 'images/thumb_p1.jpg')).toBe(false);
    });

    it('selectPhotos treats an empty list as all the photos', async () => {
      const a = await seed();
      const svc = createBackupService({ ...a, newId: () => 'x' });
      expect(await svc.selectPhotos([])).toHaveLength(2);
      expect(await svc.selectPhotos(['p2'])).toHaveLength(1);
    });
  });

  describe('round trip', () => {
    it('restores on a second machine what the first one exported', async () => {
      const a = await seed();
      const writer = await exportAll(a);
      const reader = memoryReader(writer.files);

      const b = await makeSet();
      const svcB = createBackupService({ ...b, newId: () => 'y' });
      const preview = await svcB.preview(reader);
      expect(preview).toMatchObject({
        hasMetadata: true,
        photos: 2,
        hasDsoOverrides: true,
        hasCustomGear: true,
        hasSetups: true,
        hasPoiCategories: true,
        hasSkyRegions: true,
        hasPlans: true,
        hasShortcuts: true,
        shortcuts: { zoomIn: '+' },
      });
      expect(preview.images.map((i) => [i.filename, i.exists])).toEqual([
        ['p1.jpg', false],
        ['p2.jpg', false],
      ]);
      expect(preview.plans).toEqual([
        { id: expect.any(String), name: 'Night 1', exists: false, setupId: 'setup-1' },
      ]);

      const result = await svcB.importFrom(reader, {
        ...everything,
        selectedImages: preview.images.map((i) => i.filename),
        selectedPlans: preview.plans.map((p) => p.id),
        selectedSetups: preview.setups.map((s) => s.id),
        selectedGear: preview.gear.map((g) => g.id),
      });
      expect(result).toEqual({ imported: 2, skipped: 0, dsoOverridesImported: 1, failed: [] });

      expect(await b.photos.list()).toEqual(await a.photos.list());
      expect(await b.plans.list()).toEqual(await a.plans.list());
      expect(await b.gear.listSetups()).toEqual(await a.gear.listSetups());
      expect(await b.gear.exportCustom()).toEqual(await a.gear.exportCustom());
      expect(await b.skyRegions.list()).toEqual(await a.skyRegions.list());
      expect(await b.poiCategories.list()).toEqual(await a.poiCategories.list());
      expect(await b.dsoOverrides.getAll()).toEqual(await a.dsoOverrides.getAll());
      expect(new TextDecoder().decode(b.blobs.store.get('p1.jpg'))).toBe('image-1');
      // The thumbnail is not a selectable image, but comes with its image: the archive's own file is written.
      expect(new TextDecoder().decode(b.blobs.store.get('thumb_p1.jpg'))).toBe('thumb-1');
      expect(b.blobs.store.has('p2.jpg')).toBe(true);
    });

    it('imports again over the same data without duplicating it', async () => {
      const a = await seed();
      const reader = memoryReader((await exportAll(a)).files);
      const svc = createBackupService({ ...a, newId: () => 'y' });
      const planIds = (await a.plans.list()).map((p) => p.id);
      const result = await svc.importFrom(reader, {
        ...everything,
        selectedPlans: planIds,
        selectedSetups: ['setup-1'],
        selectedGear: ['custom-t1', 'custom-c1'],
      });
      expect(result.failed).toEqual([]);
      expect(await a.photos.list()).toHaveLength(2);
      expect(await a.plans.list()).toHaveLength(1);
      expect(await a.gear.listSetups()).toHaveLength(1);
    });
  });

  describe('photos that share a name', () => {
    const named = (id: string, name: string, notes = '') => ({
      id,
      filename: `${id}.jpg`,
      originalName: name,
      width: 1,
      height: 1,
      notes,
    });
    const notesById = async (set: Awaited<ReturnType<typeof makeSet>>) =>
      Object.fromEntries((await set.photos.list()).map((p) => [p.id, p.notes]));

    it('keeps both when a machine imports its own backup again', async () => {
      const a = await makeSet();
      for (const id of ['P', 'Q']) {
        await a.photos.importPhoto(named(id, 'result.jpg'), 'skip');
        a.blobs.store.set(`${id}.jpg`, text(`image-${id}`));
      }
      const writer = memoryWriter();
      const svc = createBackupService({ ...a, newId: () => 'y' });
      await svc.exportTo(writer, { options: {} });
      const result = await svc.importFrom(memoryReader(writer.files), {
        ...everything,
        selectedImages: ['P.jpg', 'Q.jpg'],
      });
      expect(result).toMatchObject({ imported: 2, skipped: 0, failed: [] });
      expect((await a.photos.list()).map((p) => p.id)).toEqual(['P', 'Q']);
    });

    it('replaces only the photo the backup carries, not the other one of the same name', async () => {
      const a = await makeSet();
      await a.photos.importPhoto(named('P', 'result.jpg', 'old'), 'skip');
      await a.photos.importPhoto(named('Q', 'result.jpg', 'mine'), 'skip');
      const svc = createBackupService({ ...a, newId: () => 'y' });
      const result = await svc.importPhotoList([named('P', 'result.jpg', 'new')], everything);
      expect(result).toMatchObject({ imported: 1, skipped: 0 });
      expect(await notesById(a)).toEqual({ P: 'new', Q: 'mine' });
    });

    it('replaces a photo of the same name under another id, once', async () => {
      const a = await makeSet();
      await a.photos.importPhoto(named('L', 'result.jpg', 'local'), 'skip');
      const svc = createBackupService({ ...a, newId: () => 'y' });
      const result = await svc.importPhotoList(
        [named('A', 'result.jpg', 'a'), named('B', 'result.jpg', 'b')],
        everything,
      );
      expect(result).toMatchObject({ imported: 2, skipped: 0 });
      expect(await notesById(a)).toEqual({ A: 'a', B: 'b' });
    });

    it('deletes nothing for a photo that is skipped', async () => {
      const a = await makeSet();
      await a.photos.importPhoto(named('L', 'result.jpg', 'local'), 'skip');
      await a.photos.importPhoto(named('X', 'other.jpg', 'kept'), 'skip');
      const svc = createBackupService({ ...a, newId: () => 'y' });
      // Its id exists here under another name, so it is skipped: the local result.jpg must stay.
      const result = await svc.importPhotoList([named('X', 'result.jpg', 'bundle')], everything);
      expect(result).toMatchObject({ imported: 0, skipped: 1 });
      expect(await notesById(a)).toEqual({ L: 'local', X: 'kept' });
    });

    it('writes no picture for a photo that is skipped, so the one here keeps its own', async () => {
      const a = await makeSet();
      await a.photos.importPhoto(named('X', 'other.jpg', 'kept'), 'skip');
      a.blobs.store.set('X.jpg', text('local-image'));
      const svc = createBackupService({ ...a, newId: () => 'y' });
      const result = await svc.importFrom(
        memoryReader([
          ['manifest.json', JSON.stringify([named('X', 'result.jpg', 'bundle')])],
          ['images/X.jpg', 'bundle-image'],
        ]),
        everything,
      );
      expect(result).toMatchObject({ imported: 0, skipped: 1 });
      expect(new TextDecoder().decode(a.blobs.store.get('X.jpg'))).toBe('local-image');
    });

    it('removes the files of the photo it replaces, and keeps those another photo names', async () => {
      const a = await makeSet();
      await a.photos.importPhoto(named('L', 'result.jpg'), 'skip');
      await a.photos.importPhoto({ ...named('P', 'm42.jpg'), filename: 'old-P.jpg' }, 'skip');
      await a.photos.importPhoto({ ...named('K', 'kept.jpg'), filename: 'shared.jpg' }, 'skip');
      await a.photos.importPhoto({ ...named('S', 's.jpg'), filename: 'shared.jpg' }, 'skip');
      for (const f of ['L.jpg', 'L_thumb.jpg', 'old-P.jpg', 'old-P_thumb.jpg', 'shared.jpg']) {
        a.blobs.store.set(f, text(f));
      }
      const svc = createBackupService({ ...a, newId: () => 'y' });
      const result = await svc.importPhotoList(
        [
          named('A', 'result.jpg'), // replaces L by its name
          named('P', 'm42.jpg'), // replaces P by its id, under a new file name
          { ...named('T', 's.jpg'), filename: 'other.jpg' }, // replaces S, whose file K still names
        ],
        everything,
      );
      expect(result).toMatchObject({ imported: 3, skipped: 0 });
      expect([...a.blobs.store.keys()].sort()).toEqual(['shared.jpg']);
    });
  });

  describe('partial import', () => {
    it('imports only the ticked plan, with its setup and the gear that setup uses', async () => {
      const a = await seed();
      const second = await a.plans.create({ name: 'Night 2' });
      const reader = memoryReader((await exportAll(a)).files);
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const first = (await a.plans.list()).find((p) => p.name === 'Night 1')!;
      const result = await svc.importFrom(reader, {
        ...everything,
        importMetadata: false,
        importDsoOverrides: false,
        importPoiCategories: false,
        importSkyRegions: false,
        selectedPlans: [first.id],
      });
      expect(result).toEqual({ imported: 0, skipped: 0, dsoOverridesImported: 0, failed: [] });
      expect((await b.plans.list()).map((p) => p.name)).toEqual(['Night 1']);
      expect(second.id).not.toBe(first.id);
      expect((await b.gear.listSetups()).map((s) => s.id)).toEqual(['setup-1']);
      expect((await b.gear.listCustomNames()).map((g) => g.id).sort()).toEqual([
        'custom-c1',
        'custom-t1',
      ]);
      expect(await b.photos.list()).toEqual([]);
      expect(await b.skyRegions.list()).toEqual([]);
      expect(await b.dsoOverrides.getAll()).toEqual({});
      expect(b.blobs.store.size).toBe(0);
    });

    it('writes the image files only for the photos it imports', async () => {
      const a = await seed();
      const reader = memoryReader((await exportAll(a)).files);
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const result = await svc.importFrom(reader, {
        ...everything,
        selectedImages: ['p2.jpg'],
      });
      expect(result).toMatchObject({ imported: 1, skipped: 1, failed: [] });
      expect((await b.photos.list()).map((p) => p.id)).toEqual(['p2']);
      expect([...b.blobs.store.keys()].sort()).toEqual(['p2.jpg', 'p2_thumb.jpg']);
    });

    it('makes the thumbnail again when it restores an image whose archive has none, over an old thumbnail', async () => {
      const a = await seed();
      const reader = memoryReader((await exportAll(a)).files);
      const b = await makeSet();
      b.blobs.store.set('p2.jpg', text('old-image'));
      b.blobs.store.set('p2_thumb.jpg', text('old-thumb'));
      const svc = createBackupService({ ...b, newId: () => 'y' });
      await svc.importFrom(reader, { ...everything, selectedImages: ['p2.jpg'] });
      expect(new TextDecoder().decode(b.blobs.store.get('p2.jpg'))).toBe('image-2');
      expect(b.blobs.store.has('p2_thumb.jpg')).toBe(true);
      expect(new TextDecoder().decode(b.blobs.store.get('p2_thumb.jpg'))).not.toBe('old-thumb');
    });

    it('writes no image file for a metadata-less import without a selection', async () => {
      const a = await seed();
      const reader = memoryReader((await exportAll(a)).files);
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      await svc.importFrom(reader, { ...everything, importMetadata: false });
      expect(b.blobs.store.size).toBe(0);
    });
  });

  describe('an item that fails', () => {
    it('lists it in `failed` and imports the others', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const good = { id: 'ok', filename: 'ok.jpg', originalName: 'ok.jpg', width: 1, height: 1 };
      const bad = {
        id: 'bad',
        filename: 'bad.jpg',
        originalName: 'bad.jpg',
        width: 1,
        height: 1,
        correspondences: [correspondences(1)[0], correspondences(1)[0]],
      };
      const reader = memoryReader([
        ['manifest.json', JSON.stringify({ manifestVersion: 1, photos: [bad, good] })],
        ['images/bad.jpg', 'x'],
        ['images/ok.jpg', 'y'],
      ]);
      const result = await svc.importFrom(reader, everything);
      expect(result.imported).toBe(1);
      expect(result.failed).toEqual([{ kind: 'photo', name: 'bad.jpg' }]);
      expect((await b.photos.list()).map((p) => p.id)).toEqual(['ok']);
    });

    it('measures the picture of a photo the backup gives no size, and lists one whose picture cannot be read', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const sized = { id: 's', filename: 's.jpg', originalName: 's.jpg', width: 7, height: 9 };
      const unsized = { id: 'u', filename: 'u.jpg', originalName: 'u.jpg' };
      const reader = memoryReader([
        ['manifest.json', JSON.stringify({ manifestVersion: 1, photos: [sized, unsized] })],
        ['images/s.jpg', 'x'],
        ['images/u.jpg', 'y'],
      ]);
      expect(await svc.importFrom(reader, everything)).toMatchObject({ imported: 2, failed: [] });
      // the backup's own size is kept; the other is the picture's (the fake codec reads 100 × 50)
      expect((await b.photos.get('s'))!).toMatchObject({ width: 7, height: 9 });
      expect((await b.photos.get('u'))!).toMatchObject({ width: 100, height: 50 });

      // a metadata-only list whose picture is not here (or not an image) has no size to give
      b.images.info = null;
      const list = [{ id: 'v', filename: 'v.jpg', originalName: 'v.jpg', width: 0, height: 0 }];
      expect(await svc.importPhotoList(list, everything)).toMatchObject({
        imported: 0,
        failed: [{ kind: 'photo', name: 'v.jpg' }],
      });
      expect(await b.photos.get('v')).toBeUndefined();
    });

    it('lists only the plan that fails when the plans are written together, and imports the others', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const plan = (id: string, entryIds: string[]) => ({
        id,
        name: `Plan ${id}`,
        entries: entryIds.map((e, i) => ({ id: e, dsoId: 'M31', position: i })),
      });
      const reader = memoryReader([
        [
          'plans.json',
          JSON.stringify([plan('a', ['a1']), plan('bad', ['dup', 'dup']), plan('c', ['c1'])]),
        ],
      ]);
      const result = await svc.importFrom(reader, {
        ...everything,
        selectedPlans: ['a', 'bad', 'c'],
      });
      expect(result.failed).toEqual([{ kind: 'plan', name: 'Plan bad' }]);
      expect((await b.plans.list()).map((p) => p.id).sort()).toEqual(['a', 'c']);
    });

    it('lists a refused override, category and region in `failed`, and imports the others', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      // None of these the import passes on can be refused by the database, so the refusal is forced: on the
      // grouped write, then on the bad item alone.
      const importOverrides = b.dsoOverrides.importMany.bind(b.dsoOverrides);
      vi.spyOn(b.dsoOverrides, 'importMany').mockImplementation(async (group) => {
        if (group.some(([id]) => id === 'M2')) throw new Error('refused');
        await importOverrides(group);
      });
      const importCategories = b.poiCategories.importMany.bind(b.poiCategories);
      vi.spyOn(b.poiCategories, 'importMany').mockImplementation(async (group) => {
        if (group.some((c) => c.id === 'cat-bad')) throw new Error('refused');
        await importCategories(group);
      });
      const importRegions = b.skyRegions.importMany.bind(b.skyRegions);
      vi.spyOn(b.skyRegions, 'importMany').mockImplementation(async (group) => {
        if (group.some((r) => r.id === 'reg-bad')) throw new Error('refused');
        await importRegions(group);
      });
      const reader = memoryReader([
        ['dso-overrides.json', JSON.stringify({ M1: { name: 'Crab' }, M2: { name: 'Bad' } })],
        [
          'poi-categories.json',
          JSON.stringify([
            { id: 'cat-a', name: 'A' },
            { id: 'cat-bad', name: 'Bad' },
            { id: 'cat-c', name: 'C' },
          ]),
        ],
        [
          'sky-regions.json',
          JSON.stringify([
            { id: 'reg-a', name: 'Region A', points: [] },
            { id: 'reg-bad', name: 'Region bad', points: [] },
          ]),
        ],
      ]);
      const result = await svc.importFrom(reader, everything);
      expect(result.failed).toEqual([
        { kind: 'dsoOverride', name: 'M2' },
        { kind: 'poiCategory', name: 'Bad' },
        { kind: 'skyRegion', name: 'Region bad' },
      ]);
      expect(result.dsoOverridesImported).toBe(1);
      expect(Object.keys(await b.dsoOverrides.getAll())).toEqual(['M1']);
      expect((await b.poiCategories.list()).map((c) => c.id).sort()).toEqual(['cat-a', 'cat-c']);
      expect((await b.skyRegions.list()).map((r) => r.id)).toEqual(['reg-a']);
    });
  });

  describe('a bundle that is not what it should be', () => {
    it('refuses an archive with no recognised file', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      const err = await svc
        .importFrom(memoryReader([['readme.txt', 'hi']]), everything)
        .catch((e) => e);
      expect(isDomainError(err)).toBe(true);
      expect(err).toMatchObject({
        kind: 'invalid',
        code: 'NO_RECOGNISED_CONTENT',
        message: 'Aucun contenu reconnu dans le ZIP',
      });
    });

    it('refuses an entry whose path leaves its folder, before anything is written', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const reader = memoryReader([
        ['dso-overrides.json', JSON.stringify({ M1: { name: 'Crab' } })],
        ['images/../evil.jpg', 'x'],
      ]);
      const err = await svc.importFrom(reader, everything).catch((e) => e);
      expect(err).toMatchObject({
        kind: 'invalid',
        code: 'INVALID_ENTRY_PATH',
        message: 'Chemin invalide dans le ZIP : images/../evil.jpg',
      });
      expect(await b.dsoOverrides.getAll()).toEqual({});
      expect(b.blobs.store.size).toBe(0);
    });

    it('skips a photo whose image is not in the archive', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const photo = { id: 'p', filename: 'p.jpg', originalName: 'p.jpg', width: 1, height: 1 };
      const reader = memoryReader([['manifest.json', JSON.stringify([photo])]]);
      expect(await svc.importFrom(reader, everything)).toEqual({
        imported: 0,
        skipped: 1,
        dsoOverridesImported: 0,
        failed: [],
      });
    });

    it('ignores a ticked plan when the archive has no plans.json', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const reader = memoryReader([
        ['dso-overrides.json', JSON.stringify({ M1: { name: 'Crab' } })],
      ]);
      const result = await svc.importFrom(reader, { ...everything, selectedPlans: ['gone'] });
      expect(result.dsoOverridesImported).toBe(1);
      expect(await b.plans.list()).toEqual([]);
    });

    it('ignores a data file that is not valid JSON', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const reader = memoryReader([
        ['dso-overrides.json', '{nope'],
        ['sky-regions.json', '{nope'],
        ['plans.json', '{nope'],
      ]);
      expect(await svc.importFrom(reader, { ...everything, selectedPlans: ['x'] })).toEqual({
        imported: 0,
        skipped: 0,
        dsoOverridesImported: 0,
        failed: [],
      });
      const preview = await svc.preview(reader);
      expect(preview).toMatchObject({ hasDsoOverrides: false, hasSkyRegions: false, plans: [] });
    });

    it('fails with the parse error when manifest.json is not JSON', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      await expect(
        svc.importFrom(memoryReader([['manifest.json', '{nope']]), everything),
      ).rejects.toThrow(SyntaxError);
    });

    it('reads a manifest of an unknown version as it reads any other (the version is not checked)', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const photo = { id: 'p', filename: 'p.jpg', originalName: 'p.jpg', width: 1, height: 1 };
      const reader = memoryReader([
        ['manifest.json', JSON.stringify({ manifestVersion: 99, photos: [photo] })],
        ['images/p.jpg', 'x'],
      ]);
      expect((await svc.preview(reader)).photos).toBe(1);
      expect(await svc.importFrom(reader, everything)).toMatchObject({ imported: 1, skipped: 0 });
      // A manifest with no photos list holds no photos.
      const empty = memoryReader([['manifest.json', JSON.stringify({ manifestVersion: 99 })]]);
      expect(await svc.importFrom(empty, everything)).toMatchObject({ imported: 0, skipped: 0 });
    });
  });

  describe('preview', () => {
    it('flags what already exists here and how a setup differs', async () => {
      const a = await seed();
      const reader = memoryReader((await exportAll(a)).files);
      // The same machine: everything exists, the setup is identical.
      const same = await createBackupService({ ...a, newId: () => 'y' }).preview(reader);
      expect(same.images.every((i) => i.exists)).toBe(true);
      expect(same.plans[0].exists).toBe(true);
      expect(same.setups).toEqual([
        { id: 'setup-1', name: 'Rig', exists: true, conflict: 'identical', localId: 'setup-1' },
      ]);
      expect(same.gear.every((g) => g.exists)).toBe(true);
      // Another camera in the local setup: it now differs.
      await a.gear.importSetup(
        {
          id: 'setup-1',
          name: 'Rig',
          telescopeId: 'custom-t1',
          cameraId: 'custom-other',
          accessoryId: null,
          enabled: true,
        },
        [],
      );
      const differs = await createBackupService({ ...a, newId: () => 'y' }).preview(reader);
      expect(differs.setups[0]).toMatchObject({ conflict: 'different', localId: 'setup-1' });
    });

    it('names custom gear by brand and model, then name, then id', async () => {
      const a = await seed();
      const reader = memoryReader([
        [
          'custom-gear.json',
          json([
            { id: 'g1', type: 'telescope', brand: 'Zed', model: 'Test 100' },
            { id: 'g2', type: 'camera', name: 'Named only' },
            { id: 'g3', type: 'accessory' },
            { id: 'g4', type: 'camera', brand: 'Zed', model: 'Cam 7', name: 'Old name' },
          ]),
        ],
      ]);
      const preview = await createBackupService({ ...a, newId: () => 'y' }).preview(reader);
      expect(preview.gear.map((g) => [g.id, g.name])).toEqual([
        ['g1', 'Zed Test 100'],
        ['g2', 'Named only'],
        ['g3', 'g3'],
        ['g4', 'Zed Cam 7'],
      ]);
    });

    it('matches custom gear without a name by brand and model, and replaces it on import', async () => {
      const a = await seed();
      await a.gear.importCustom(
        { id: 'custom-brand', type: 'telescope', data: { brand: 'Zed', model: 'Test 100' } },
        [],
      );
      const reader = memoryReader([
        [
          'custom-gear.json',
          json([
            {
              id: 'other-id',
              type: 'telescope',
              brand: 'Zed',
              model: 'Test 100',
              focalLength: 600,
            },
          ]),
        ],
      ]);
      const svc = createBackupService({ ...a, newId: () => 'y' });
      expect((await svc.preview(reader)).gear).toEqual([
        { id: 'other-id', type: 'telescope', name: 'Zed Test 100', exists: true },
      ]);
      const before = (await a.gear.listCustomNames()).length;
      const result = await svc.importFrom(reader, { ...everything, selectedGear: ['other-id'] });
      expect(result.failed).toEqual([]);
      const after = await a.gear.listCustomNames();
      expect(after).toHaveLength(before);
      expect(after.filter((g) => g.name === 'Zed Test 100').map((g) => g.id)).toEqual(['other-id']);
    });

    it('previews an empty archive as empty, and a JSON list of photos without images', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      expect(await svc.preview(memoryReader([]))).toMatchObject({
        hasMetadata: false,
        photos: 0,
        images: [],
      });
      expect(svc.previewPhotoList([{ id: 'a' }, { id: 'b' }])).toMatchObject({
        hasMetadata: true,
        photos: 2,
        hasShortcuts: false,
        images: [],
      });
      expect(svc.previewPhotoList([]).hasMetadata).toBe(false);
      expect(() => svc.previewPhotoList({ photos: [] })).toThrow('Format de manifeste invalide');
    });
  });

  describe('a plain JSON list of photos', () => {
    it('imports the records without any image file', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const list = [{ id: 'j1', filename: 'j1.jpg', originalName: 'j1.jpg', width: 1, height: 1 }];
      expect(await svc.importPhotoList(list, everything)).toEqual({
        imported: 1,
        skipped: 0,
        dsoOverridesImported: 0,
        failed: [],
      });
      expect((await b.photos.list()).map((p) => p.id)).toEqual(['j1']);
      expect(await svc.importPhotoList([{ nope: 1 }], everything)).toMatchObject({
        imported: 0,
        skipped: 1,
      });
    });

    it('refuses anything but a list', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      const err = await svc.importPhotoList({ photos: [] }, everything).catch((e) => e);
      expect(err).toMatchObject({ kind: 'invalid', code: 'INVALID_MANIFEST_FORMAT' });
    });
  });

  describe('an uploaded file', () => {
    const photoList = [
      { id: 'j1', filename: 'j1.jpg', originalName: 'j1.jpg', width: 1, height: 1 },
    ];
    /** A file whose ZIP is a fixed reader; `opened` counts how many times the service asked to open it. */
    function fileOf(name: string, bytes: Uint8Array, reader?: BundleReader) {
      const file = {
        opened: 0,
        name,
        read: async () => bytes,
        async openZip() {
          file.opened++;
          if (!reader) throw new Error('not a zip');
          return reader;
        },
      };
      return file satisfies BackupFile;
    }
    const zipReader = () =>
      memoryReader([
        ['manifest.json', JSON.stringify(photoList)],
        ['images/j1.jpg', 'x'],
      ]);

    it('previews a ZIP through its reader, opened once', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      const file = fileOf('Backup.ZIP', new Uint8Array(), zipReader());
      const result = await svc.previewFile(file);
      expect(result).toEqual(await svc.preview(zipReader()));
      expect(result.photos).toBe(1);
      expect(file.opened).toBe(1);
    });

    it('previews a JSON list without opening a ZIP', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      const file = fileOf('list.json', json(photoList));
      expect(await svc.previewFile(file)).toEqual(svc.previewPhotoList(photoList));
      expect(file.opened).toBe(0);
    });

    it('imports a ZIP through its reader', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const file = fileOf('a.zip', new Uint8Array(), zipReader());
      expect(await svc.importFile(file, everything)).toMatchObject({ imported: 1, failed: [] });
      expect((await b.photos.list()).map((p) => p.id)).toEqual(['j1']);
      expect(file.opened).toBe(1);
    });

    it('imports a JSON list without opening a ZIP', async () => {
      const b = await makeSet();
      const svc = createBackupService({ ...b, newId: () => 'y' });
      const file = fileOf('a.json', json(photoList));
      expect(await svc.importFile(file, everything)).toEqual({
        imported: 1,
        skipped: 0,
        dsoOverridesImported: 0,
        failed: [],
      });
      expect(file.opened).toBe(0);
    });

    it.each(['notes.txt', 'archive', 'archive.zip.bak', '.zip'])(
      'refuses %s, which is neither a ZIP nor a JSON list, and opens nothing',
      async (name) => {
        const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
        const file = fileOf(name, json(photoList), zipReader());
        for (const run of [() => svc.previewFile(file), () => svc.importFile(file, everything)]) {
          const err = await run().catch((e) => e);
          expect(err).toMatchObject({
            kind: 'invalid',
            code: 'UNSUPPORTED_BUNDLE_FORMAT',
            message: 'Format non supporté (.zip ou .json attendu)',
          });
        }
        expect(file.opened).toBe(0);
      },
    );

    it('lets a JSON file that is not JSON fail with the parser error, and a JSON that is not a list with the manifest error', async () => {
      const svc = createBackupService({ ...(await makeSet()), newId: () => 'y' });
      await expect(svc.previewFile(fileOf('a.json', text('{oops')))).rejects.toBeInstanceOf(
        SyntaxError,
      );
      const err = await svc
        .importFile(fileOf('a.json', json({ photos: [] })), everything)
        .catch((e) => e);
      expect(err).toMatchObject({ kind: 'invalid', code: 'INVALID_MANIFEST_FORMAT' });
    });
  });

  describe('round trips', () => {
    let counted: CountingSqlDb;
    async function makeCounted() {
      const set = await makeSet((db) => (counted = countingSqlDb(db)));
      return { set, svc: createBackupService({ ...set, newId: () => 'y' }) };
    }

    const plan = (id: string, entries: number) => ({
      id,
      name: `Plan ${id}`,
      entries: Array.from({ length: entries }, (_, i) => ({
        id: `${id}-e${i}`,
        dsoId: `NGC ${i + 1}`,
        position: i,
      })),
    });
    const photo = (id: string, points: number) => ({
      id,
      filename: `${id}.jpg`,
      originalName: `${id}.jpg`,
      width: 1,
      height: 1,
      correspondences: correspondences(points),
    });

    async function importCalls(
      files: readonly [string, Uint8Array | string][],
      selection: Partial<ImportOptions>,
    ): Promise<number> {
      const { svc } = await makeCounted();
      counted.reset();
      await svc.importFrom(memoryReader(files), { ...everything, ...selection });
      return counted.calls();
    }

    it('a plan costs the same however many entries it has', async () => {
      const small = await importCalls([['plans.json', JSON.stringify([plan('a', 1)])]], {
        selectedPlans: ['a'],
      });
      const big = await importCalls([['plans.json', JSON.stringify([plan('a', 40)])]], {
        selectedPlans: ['a'],
      });
      expect(big).toBe(small);
    });

    it('a photo costs the same however many correspondences it has', async () => {
      const files = (points: number): [string, string][] => [
        ['manifest.json', JSON.stringify([photo('a', points)])],
        ['images/a.jpg', 'x'],
      ];
      const small = await importCalls(files(2), {});
      const big = await importCalls(files(60), {});
      expect(big).toBe(small);
    });

    it('an import costs the same however many items it has: fixed reads + one write per kind', async () => {
      const calls = async (plans: number, photos: number) => {
        const ids = Array.from({ length: plans }, (_, i) => `pl${i}`);
        const files: [string, string][] = [
          ['plans.json', JSON.stringify(ids.map((id) => plan(id, 3)))],
          [
            'manifest.json',
            JSON.stringify(Array.from({ length: photos }, (_, i) => photo(`ph${i}`, 3))),
          ],
          ...Array.from({ length: photos }, (_, i): [string, string] => [`images/ph${i}.jpg`, 'x']),
        ];
        return importCalls(files, { selectedPlans: ids });
      };
      // The formula: calls = 2 reads (local setups, local gear) + 1 read when plans are ticked (plan names)
      // + 3 reads when photos are imported (names already here; the photos already here and their correspondences)
      // + 1 for the plans (one batch) + 4 for the photos (one transaction: begin, the ids here, one batch, commit).
      expect(await calls(1, 1)).toBe(11);
      expect(await calls(5, 1)).toBe(11);
      expect(await calls(1, 6)).toBe(11);
      expect(await calls(4, 3)).toBe(11);
    });

    it('gear, setups, categories, regions and overrides cost one write per kind however many there are', async () => {
      const calls = async (n: number) => {
        const ids = (prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
        const gearList = ids('custom-t').map((id) => ({ id, type: 'telescope', name: id }));
        const setupList = ids('setup-').map((id) => ({
          id,
          name: id,
          telescopeId: 'custom-t0',
          cameraId: 'cam-builtin',
          accessoryId: null,
          enabled: true,
        }));
        const files: [string, string][] = [
          ['custom-gear.json', JSON.stringify(gearList)],
          ['gear-setups.json', JSON.stringify(setupList)],
          [
            'poi-categories.json',
            JSON.stringify(ids('cat-').map((id) => ({ id, name: id, color: '#fff' }))),
          ],
          [
            'sky-regions.json',
            JSON.stringify(ids('r-').map((id) => ({ id, name: id, points: [[0, 0]] }))),
          ],
          [
            'dso-overrides.json',
            JSON.stringify(Object.fromEntries(ids('NGC ').map((id) => [id, { name: id }]))),
          ],
        ];
        return importCalls(files, {
          selectedGear: gearList.map((g) => g.id),
          selectedSetups: setupList.map((s) => s.id),
        });
      };
      // 2 reads (local setups, local gear) + one batch each for gear, setups, categories, regions, overrides.
      expect(await calls(1)).toBe(7);
      expect(await calls(8)).toBe(7);
    });
  });
});

describe('backupFileName', () => {
  it('names an export after the UTC time, as a ZIP by default', () => {
    const now = new Date('2026-10-06T14:03:59.123Z');
    expect(backupFileName(now)).toBe('sky-export-2026-10-06-14-03-59.zip');
    expect(backupFileName(now, 'json')).toBe('sky-export-2026-10-06-14-03-59.json');
  });
});
