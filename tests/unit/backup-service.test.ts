// @vitest-environment node
/**
 * The backup service (WP2.8): export, preview and import, on both SQL adapters, with the archive and the
 * blob store in memory. The routes themselves are pinned by `server-backup.test.ts`.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import type { ImportOptions } from '@myastrosky/core/domain/backup';
import { isDomainError } from '@myastrosky/core/domain/errors';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createBackupService } from '@myastrosky/core/services/backup';
import { createServices } from '../../server/create-services';
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
      // The thumbnail was in the bundle but is not a selectable image: it is regenerated.
      expect(b.blobs.store.has('thumb_p1.jpg')).toBe(true);
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

    it('an import grows with the number of items: fixed reads + one transaction per plan and per photo', async () => {
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
      const base = await calls(1, 1);
      const perPlan = (await calls(2, 1)) - base;
      const perPhoto = (await calls(1, 2)) - base;
      // The formula: calls = 2 reads (local setups, local gear) + 1 read when plans are ticked (plan names)
      // + 1 read when photos are imported (names already here) + 1 per plan (one batch) + 4 per new photo
      // (its transaction: begin, existence check, one batch, commit). 9 for one plan and one photo.
      expect(base).toBe(9);
      expect(perPlan).toBe(1);
      expect(perPhoto).toBe(4);
      expect(await calls(5, 1)).toBe(base + 4 * perPlan);
      expect(await calls(1, 6)).toBe(base + 5 * perPhoto);
      expect(await calls(4, 3)).toBe(base + 3 * perPlan + 2 * perPhoto);
    });
  });
});
