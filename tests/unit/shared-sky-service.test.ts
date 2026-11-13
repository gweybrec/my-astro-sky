// @vitest-environment node
/**
 * Sharing a sky by file: one machine writes a package, another keeps it as a visit, on both SQL adapters, with the
 * archive and the blob store in memory. A visit never shows among the visitor's own photos.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import {
  cleanSkyName,
  parseShareManifest,
  shareFileName,
  sharedSkyStatus,
} from '@myastrosky/core/domain/shared-sky';
import type { BundleReader, BundleWriter } from '@myastrosky/core/ports/bundle';
import { createServices } from '@myastrosky/core/services/create-services';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { fakeImageCodec, memoryBlobStore } from '../helpers/fake-image-io';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const parse = (b: Uint8Array | undefined): any => JSON.parse(new TextDecoder().decode(b));

type Files = [string, Uint8Array][];

function memoryWriter(): BundleWriter & { files: Files } {
  const files: Files = [];
  return {
    files,
    async add(name, bytes) {
      files.push([name, bytes]);
    },
  };
}

function memoryReader(files: Files): BundleReader {
  const find = (name: string) => files.find(([n]) => n === name);
  return {
    names: async () => files.map(([n]) => n),
    read: async (name) => find(name)?.[1] ?? null,
    size: async (name) => find(name)?.[1].byteLength ?? null,
  };
}

/** The package `files` with its manifest changed by `change`. */
function withManifest(files: Files, change: (manifest: any) => void): Files {
  return files.map(([name, bytes]): [string, Uint8Array] => {
    if (name !== 'share.json') return [name, bytes];
    const manifest = parse(bytes);
    change(manifest);
    return [name, text(JSON.stringify(manifest))];
  });
}

const correspondences = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    pointIndex: i,
    photoX: i,
    photoY: i + 1,
    starHip: 1000 + i,
    starName: `Star ${i}`,
  }));

describe.each(SQL_ADAPTERS)('shared sky service on the %s adapter', (_name, wrap) => {
  let opened: Database.Database[] = [];
  let machines = 0;

  async function makeSet() {
    const raw = new Database(':memory:');
    opened.push(raw);
    const db = wrap(createBetterSqliteDb(raw));
    await initSchema(db);
    const blobs = memoryBlobStore();
    const images = fakeImageCodec();
    const machine = ++machines;
    let n = 0;
    const clock = { now: Date.parse('2026-03-01T10:00:00.000Z') };
    const room: { free: number | null } = { free: null };
    const services = createServices({
      db,
      newId: () => `machine${machine}-id-${++n}`,
      secrets: {
        canEncrypt: () => false,
        encrypt: async (s) => s,
        decrypt: async (s) => s,
        isEncrypted: () => false,
      },
      env: () => undefined,
      platform: { isWindows: false },
      gearCatalog: {
        telescopes: [{ id: 't1', brand: 'Sky', model: '80ED' }],
        cameras: [{ id: 'c1', brand: 'ZWO', model: 'ASI533' }],
        accessories: [],
        filters: [],
      },
      images,
      blobs,
      stars: [],
      http: async () => {
        throw new Error('no network in this test');
      },
      now: () => clock.now,
      freeBytes: async () => room.free,
    });
    return { ...services, blobs, images, clock, room, raw };
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

  /** The sender: two photos, the first with a setup, capture details, a point of interest and a placement. */
  async function sender() {
    const a = await makeSet();
    const { id: setupId } = await a.gear.createSetup({
      name: 'Travel',
      telescopeId: 't1',
      cameraId: 'c1',
    });
    const { id: categoryId } = await a.poiCategories.create({ name: 'Comet', color: '#00ff00' });
    await a.poiCategories.create({ name: 'Unused', color: '#123456' });
    await a.photos.insert({
      id: 'p1',
      filename: 'p1.jpg',
      thumbFilename: 'p1_thumb.jpg',
      originalName: 'M31.jpg',
      width: 100,
      height: 50,
      correspondences: correspondences(3),
      notes: 'first',
      dsoIds: ['M31'],
      labels: ['galaxy'],
      integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
      observationDate: '2026-01-02T20:00:00.000Z',
      pointsOfInterest: [{ name: 'C/2025 A1', categoryId }],
      captureDetails: { gain: 100 },
      gearSetupId: setupId,
      manualPlacement: JSON.stringify({
        centerRa: 10,
        centerDec: 41,
        rotationDeg: 5,
        projPerPx: 0.001,
        mirrorX: false,
        mirrorY: true,
      }),
    });
    await a.photos.insert({
      id: 'p2',
      filename: 'p2.png',
      originalName: 'M42.png',
      width: 100,
      height: 50,
      correspondences: correspondences(2),
    });
    a.blobs.store.set('p1.jpg', text('image-1'));
    a.blobs.store.set('p1_thumb.jpg', text('thumb-1'));
    a.blobs.store.set('p2.png', text('image-22'));
    return a;
  }

  async function packageOf(
    a: Awaited<ReturnType<typeof makeSet>>,
    request: { ids?: string[]; senderName?: string; includeGear?: boolean } = {},
  ): Promise<Files> {
    const writer = memoryWriter();
    await a.sharedSkies.exportTo(writer, { senderName: 'Paul', includeGear: true, ...request });
    return writer.files;
  }

  describe('writing a package', () => {
    it('writes the pictures, then a manifest with what places and describes each photo', async () => {
      const a = await sender();
      const files = await packageOf(a);
      expect(files.map(([name]) => name)).toEqual(['images/p1.jpg', 'images/p2.png', 'share.json']);
      const manifest = parse(files[2][1]);
      expect(manifest).toMatchObject({
        kind: 'shared-sky',
        formatVersion: 2,
        senderName: 'Paul',
        sharedAt: '2026-03-01T10:00:00.000Z',
        poiCategories: [{ name: 'Comet', color: '#00ff00' }],
      });
      expect(manifest.skyId).toMatch(/^machine\d+-id-\d+$/);
      expect(manifest.photos).toHaveLength(2);
      expect(manifest.photos[0]).toMatchObject({
        id: 'p1',
        file: 'p1.jpg',
        bytes: 7,
        originalName: 'M31.jpg',
        width: 100,
        height: 50,
        notes: 'first',
        // Each photo carries its author: the name it is shared under.
        author: 'Paul',
        dsoIds: ['M31'],
        labels: ['galaxy'],
        integrations: [{ frames: 10, seconds: 60, filter: 'L' }],
        observationDate: '2026-01-02T20:00:00.000Z',
        captureDetails: { gain: 100 },
        gear: { setup: 'Travel', telescope: 'Sky 80ED', camera: 'ZWO ASI533' },
        manualPlacement: { centerRa: 10, mirrorY: true },
      });
      expect(manifest.photos[0].correspondences).toHaveLength(3);
      // Nothing that only means something here: no setup id, no thumbnail, no site.
      const written = JSON.stringify(manifest);
      expect(written).not.toContain('gearSetupId');
      expect(written).not.toContain('thumb');
      expect(manifest.photos[1].gear).toBeUndefined();
      expect(manifest.photos[1].captureDetails).toBeUndefined();
    });

    it('leaves gear and capture details out when asked, and keeps the integrations', async () => {
      const a = await sender();
      const manifest = parse((await packageOf(a, { includeGear: false })).at(-1)![1]);
      expect(manifest.photos[0].gear).toBeUndefined();
      expect(manifest.photos[0].captureDetails).toBeUndefined();
      expect(manifest.photos[0].integrations).toHaveLength(1);
    });

    it('shares only the chosen photos, and remembers the name and the sky id', async () => {
      const a = await sender();
      expect(await a.sharedSkies.senderName()).toBe('');
      const first = parse(
        (await packageOf(a, { ids: ['p2'], senderName: '  Paul D.  ' })).at(-1)![1],
      );
      expect(first.photos.map((p: any) => p.id)).toEqual(['p2']);
      expect(first.senderName).toBe('Paul D.');
      expect(first.poiCategories).toEqual([]);
      expect(await a.sharedSkies.senderName()).toBe('Paul D.');
      const second = parse((await packageOf(a)).at(-1)![1]);
      expect(second.skyId).toBe(first.skyId);
    });

    it('refuses a blank name, and a selection with no picture', async () => {
      const a = await sender();
      await expect(packageOf(a, { senderName: '   ' })).rejects.toMatchObject({
        code: 'SHARED_SKY_NAME_REQUIRED',
      });
      a.blobs.store.delete('p2.png');
      await expect(packageOf(a, { ids: ['p2'] })).rejects.toMatchObject({
        code: 'SHARED_SKY_NOTHING_TO_SHARE',
      });
      // A photo whose picture is missing is left out of the others.
      const manifest = parse((await packageOf(a)).at(-1)![1]);
      expect(manifest.photos.map((p: any) => p.id)).toEqual(['p1']);
    });
  });

  describe('keeping a visit', () => {
    it('shows what a package holds before anything is written', async () => {
      const a = await sender();
      const b = await makeSet();
      b.room.free = 5000;
      const preview = await b.sharedSkies.inspect(memoryReader(await packageOf(a)));
      expect(preview).toMatchObject({
        senderName: 'Paul',
        sharedAt: '2026-03-01T10:00:00.000Z',
        photoCount: 2,
        bytes: 15,
        status: 'new',
        freeBytes: 5000,
      });
      expect(preview.existing).toBeUndefined();
      expect(b.blobs.store.size).toBe(0);
      expect(await b.sharedSkies.list()).toEqual([]);
    });

    it('keeps the photos under new names, with thumbnails, and gives them back as photos of that sky', async () => {
      const a = await sender();
      const b = await makeSet();
      const progress: [number, number][] = [];
      const sky = await b.sharedSkies.open(memoryReader(await packageOf(a)), {
        onProgress: (done, total) => progress.push([done, total]),
      });
      expect(progress).toEqual([
        [1, 2],
        [2, 2],
      ]);
      expect(sky).toMatchObject({
        senderName: 'Paul',
        photoCount: 2,
        // Two pictures (7 and 8 bytes) and two thumbnails of one byte.
        bytes: 17,
        poiCategories: [{ name: 'Comet', color: '#00ff00' }],
      });
      expect(await b.sharedSkies.list()).toEqual([sky]);

      const photos = await b.sharedSkies.listPhotos(sky.id);
      expect(photos.map((p) => p.originalName)).toEqual(['M31.jpg', 'M42.png']);
      const [m31, m42] = photos;
      expect(m31).toMatchObject({
        sharedSkyId: sky.id,
        author: 'Paul',
        width: 100,
        height: 50,
        notes: 'first',
        dsoIds: ['M31'],
        labels: ['galaxy'],
        gearSetupId: null,
        sharedGear: { setup: 'Travel', telescope: 'Sky 80ED', camera: 'ZWO ASI533' },
        captureDetails: { gain: 100 },
        manualPlacement: { centerRa: 10, mirrorY: true },
        fileSize: 7,
      });
      expect(m31.correspondences).toEqual(correspondences(3));
      expect(m31.pointsOfInterest).toMatchObject([{ name: 'C/2025 A1' }]);
      expect(m42.sharedGear).toBeUndefined();
      // Names made here, never the sender's.
      expect(m31.id).toMatch(/^machine\d+-id-/);
      expect(m31.filename).toBe(`${m31.id}.jpg`);
      expect(m42.filename).toBe(`${m42.id}.png`);
      expect(m31.thumbFilename).toBe(`${m31.id}_thumb.jpg`);
      expect([...b.blobs.store.keys()].sort()).toEqual(
        [m31.filename, m31.thumbFilename, m42.filename, m42.thumbFilename].sort(),
      );
      expect(b.blobs.store.get(m31.filename)).toEqual(text('image-1'));
    });

    it('never shows a visit among the visitor own photos, whatever reads them', async () => {
      const a = await sender();
      const b = await makeSet();
      await b.photos.insert({
        id: 'mine',
        filename: 'mine.jpg',
        originalName: 'M31.jpg',
        width: 10,
        height: 10,
        correspondences: correspondences(2),
      });
      b.blobs.store.set('mine.jpg', text('my picture'));
      const sky = await b.sharedSkies.open(memoryReader(await packageOf(a)));

      expect((await b.photos.list()).map((p) => p.id)).toEqual(['mine']);
      expect((await b.photos.listWithSizes()).map((p) => p.id)).toEqual(['mine']);
      expect(await b.photos.findByOriginalNames(['M31.jpg', 'M42.png'])).toEqual([
        { originalName: 'M31.jpg', id: 'mine' },
      ]);
      await expect(b.photos.setOrder(['mine'])).resolves.toBeUndefined();
      const backup = memoryWriter();
      await b.backup.exportTo(backup, {});
      expect(backup.files.map(([name]) => name)).toEqual(['manifest.json', 'images/mine.jpg']);
      expect(parse(backup.files[0][1]).photos.map((p: any) => p.id)).toEqual(['mine']);

      // A visit photo is no photo for the functions that change one.
      const [visitPhoto] = await b.sharedSkies.listPhotos(sky.id);
      expect(await b.photos.get(visitPhoto.id)).toBeUndefined();
      await expect(b.photos.remove(visitPhoto.id)).rejects.toMatchObject({
        code: 'PHOTO_NOT_FOUND',
      });
      await expect(b.photos.updateMetadata(visitPhoto.id, { notes: 'x' })).rejects.toMatchObject({
        code: 'PHOTO_NOT_FOUND',
      });
      await expect(b.photos.rotateRight(visitPhoto.id)).rejects.toMatchObject({
        code: 'PHOTO_NOT_FOUND',
      });

      // Deleting every photo of the visitor leaves the visit and its files.
      expect(await b.photos.removeAll()).toBe(1);
      expect(await b.sharedSkies.listPhotos(sky.id)).toHaveLength(2);
      expect(b.blobs.store.has(visitPhoto.filename)).toBe(true);
    });

    it('opens the sender own sky on the sender own machine without touching its photos', async () => {
      const a = await sender();
      const before = await a.photos.list();
      const sky = await a.sharedSkies.open(memoryReader(await packageOf(a)));
      expect(await a.photos.list()).toEqual(before);
      expect(a.blobs.store.get('p1.jpg')).toEqual(text('image-1'));
      expect(await a.sharedSkies.listPhotos(sky.id)).toHaveLength(2);
      await a.sharedSkies.remove(sky.id);
      expect(await a.photos.list()).toEqual(before);
      expect([...a.blobs.store.keys()].sort()).toEqual(['p1.jpg', 'p1_thumb.jpg', 'p2.png']);
    });

    it('replaces the visit by a newer package of the same sky, under the sender new name', async () => {
      const a = await sender();
      const b = await makeSet();
      const first = await b.sharedSkies.open(memoryReader(await packageOf(a)));
      const oldFiles = [...b.blobs.store.keys()];

      a.clock.now += 86_400_000;
      const newer = await packageOf(a, { ids: ['p2'], senderName: 'Paul D.' });
      expect(await b.sharedSkies.inspect(memoryReader(newer))).toMatchObject({
        status: 'update',
        photoCount: 1,
        existing: {
          senderName: 'Paul',
          sharedAt: '2026-03-01T10:00:00.000Z',
          photoCount: 2,
        },
      });
      const second = await b.sharedSkies.open(memoryReader(newer));
      expect(second).toMatchObject({
        id: first.id,
        senderName: 'Paul D.',
        sharedAt: '2026-03-02T10:00:00.000Z',
        photoCount: 1,
      });
      expect(await b.sharedSkies.list()).toHaveLength(1);
      const photos = await b.sharedSkies.listPhotos(first.id);
      expect(photos.map((p) => [p.originalName, p.author])).toEqual([['M42.png', 'Paul D.']]);
      // The pictures of the earlier package are gone.
      for (const name of oldFiles) expect(b.blobs.store.has(name)).toBe(false);
      expect(b.blobs.store.size).toBe(2);
    });

    it("reads a visit photo kept without its author as its sky's sender's", async () => {
      const a = await sender();
      const b = await makeSet();
      const sky = await b.sharedSkies.open(memoryReader(await packageOf(a)));
      b.raw.prepare("UPDATE shared_sky_photos SET author = ''").run();
      expect((await b.sharedSkies.listPhotos(sky.id)).map((p) => p.author)).toEqual([
        'Paul',
        'Paul',
      ]);
    });

    it('tells an older package and the same package from a newer one', async () => {
      const a = await sender();
      const b = await makeSet();
      const older = await packageOf(a);
      a.clock.now += 1000;
      const newer = await packageOf(a);
      await b.sharedSkies.open(memoryReader(newer));
      expect((await b.sharedSkies.inspect(memoryReader(newer))).status).toBe('same');
      expect((await b.sharedSkies.inspect(memoryReader(older))).status).toBe('older');
      // Going back is the user's choice: the service does it when asked.
      const sky = await b.sharedSkies.open(memoryReader(older));
      expect(sky.sharedAt).toBe('2026-03-01T10:00:00.000Z');
    });

    it('keeps two skies apart', async () => {
      const a = await sender();
      const c = await sender();
      const b = await makeSet();
      const fromA = await b.sharedSkies.open(memoryReader(await packageOf(a)));
      const fromC = await b.sharedSkies.open(
        memoryReader(await packageOf(c, { senderName: 'Zoe' })),
      );
      expect(fromC.id).not.toBe(fromA.id);
      expect((await b.sharedSkies.list()).map((s) => s.senderName).sort()).toEqual(['Paul', 'Zoe']);
      await b.sharedSkies.remove(fromA.id);
      expect(await b.sharedSkies.listPhotos(fromC.id)).toHaveLength(2);
      expect(b.blobs.store.size).toBe(4);
    });

    it('leaves nothing behind when it is cancelled, and keeps the earlier visit', async () => {
      const a = await sender();
      const b = await makeSet();
      const first = await b.sharedSkies.open(memoryReader(await packageOf(a)));
      const filesBefore = [...b.blobs.store.keys()].sort();
      a.clock.now += 1000;

      const cancel = {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
      await expect(
        b.sharedSkies.open(memoryReader(await packageOf(a)), {
          cancel,
          onProgress: () => {
            cancel.aborted = true;
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect([...b.blobs.store.keys()].sort()).toEqual(filesBefore);
      expect(await b.sharedSkies.list()).toEqual([first]);
      expect(await b.sharedSkies.listPhotos(first.id)).toHaveLength(2);
    });

    it('leaves nothing behind when a picture cannot be written', async () => {
      const a = await sender();
      const b = await makeSet();
      const put = b.blobs.put.bind(b.blobs);
      let puts = 0;
      b.blobs.put = async (name, bytes) => {
        if (++puts === 3) throw new Error('disk full');
        return put(name, bytes);
      };
      await expect(b.sharedSkies.open(memoryReader(await packageOf(a)))).rejects.toThrow(
        'disk full',
      );
      expect(b.blobs.store.size).toBe(0);
      expect(await b.sharedSkies.list()).toEqual([]);
    });

    it('leaves out a file that is not a picture, and keeps a photo whose thumbnail cannot be made', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = await packageOf(a);
      b.images.failThumbnail = true;
      const sky = await b.sharedSkies.open(memoryReader(files));
      const photos = await b.sharedSkies.listPhotos(sky.id);
      expect(photos.map((p) => p.thumbFilename)).toEqual([null, null]);

      const c = await makeSet();
      c.images.info = null;
      const empty = await c.sharedSkies.open(memoryReader(files));
      expect(empty.photoCount).toBe(0);
      expect(c.blobs.store.size).toBe(0);
    });

    it('refuses a package the room left cannot hold, before writing anything', async () => {
      const a = await sender();
      const b = await makeSet();
      b.room.free = 10;
      await expect(b.sharedSkies.open(memoryReader(await packageOf(a)))).rejects.toMatchObject({
        code: 'NOT_ENOUGH_SPACE',
      });
      expect(b.blobs.store.size).toBe(0);
      b.room.free = 16;
      await expect(b.sharedSkies.open(memoryReader(await packageOf(a)))).resolves.toBeTruthy();
    });

    it('deletes a visit, and says how much room deleting freed', async () => {
      const a = await sender();
      const b = await makeSet();
      const sky = await b.sharedSkies.open(memoryReader(await packageOf(a)));
      expect(await b.sharedSkies.remove(sky.id)).toEqual({ bytesFreed: 17 });
      expect(b.blobs.store.size).toBe(0);
      expect(await b.sharedSkies.list()).toEqual([]);
      expect(b.raw.prepare('SELECT COUNT(*) AS n FROM shared_sky_photos').get()).toEqual({ n: 0 });
      await expect(b.sharedSkies.remove(sky.id)).rejects.toMatchObject({
        code: 'SHARED_SKY_NOT_FOUND',
      });
      await expect(b.sharedSkies.listPhotos(sky.id)).rejects.toMatchObject({
        code: 'SHARED_SKY_NOT_FOUND',
      });
    });

    it('makes the medium-sized copies of a visit large pictures, and none for the visitor photos table', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = withManifest(await packageOf(a), (m) => {
        m.photos[0].width = 6000;
        m.photos[0].height = 4000;
      });
      const sky = await b.sharedSkies.open(memoryReader(files));
      expect(await b.photos.makeMissingMediums()).toBe(0);
      expect(await b.sharedSkies.makeMissingMediums()).toBe(1);
      expect(await b.sharedSkies.makeMissingMediums()).toBe(0);
      const [large, small] = await b.sharedSkies.listPhotos(sky.id);
      expect(large.mediumFilename).toBe(`${large.id}_medium.jpg`);
      expect(small.mediumFilename).toBeNull();
      // The copy goes with the visit.
      await b.sharedSkies.remove(sky.id);
      expect(b.blobs.store.size).toBe(0);
    });
  });

  describe('a file that is not a usable package', () => {
    it('refuses a backup, a package without manifest and a manifest that is not JSON', async () => {
      const a = await sender();
      const b = await makeSet();
      const backup = memoryWriter();
      await a.backup.exportTo(backup, {});
      for (const files of [
        backup.files,
        [['images/p1.jpg', text('x')]] as Files,
        [['share.json', text('{ not json')]] as Files,
        [['share.json', text('{"kind":"backup"}')]] as Files,
      ]) {
        await expect(b.sharedSkies.inspect(memoryReader(files))).rejects.toMatchObject({
          code: 'NOT_A_SHARED_SKY',
        });
        await expect(b.sharedSkies.open(memoryReader(files))).rejects.toMatchObject({
          code: 'NOT_A_SHARED_SKY',
        });
      }
      expect(b.blobs.store.size).toBe(0);
    });

    it('refuses a package written by a later version', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = withManifest(await packageOf(a), (m) => (m.formatVersion = 3));
      await expect(b.sharedSkies.inspect(memoryReader(files))).rejects.toMatchObject({
        code: 'SHARED_SKY_UNSUPPORTED',
      });
    });

    it('refuses a path that leaves its folder and a file that comes twice', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = await packageOf(a);
      await expect(
        b.sharedSkies.open(memoryReader([...files, ['images/../../evil.jpg', text('x')]])),
      ).rejects.toMatchObject({ code: 'INVALID_ENTRY_PATH' });
      await expect(
        b.sharedSkies.open(memoryReader([...files, ['images/p1.jpg', text('x')]])),
      ).rejects.toMatchObject({ code: 'INVALID_ENTRY_PATH' });
      expect(b.blobs.store.size).toBe(0);
    });

    it('leaves out a photo whose picture name is not a plain picture file name', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = withManifest(await packageOf(a), (m) => {
        m.photos[0].file = '../p1.jpg';
        m.photos.push(
          { ...m.photos[1], id: 'p3', file: 'p2.PNG' },
          { ...m.photos[1], file: 'run.exe' },
        );
      });
      const preview = await b.sharedSkies.inspect(memoryReader(files));
      expect(preview.photoCount).toBe(1);
      const sky = await b.sharedSkies.open(memoryReader(files));
      expect((await b.sharedSkies.listPhotos(sky.id)).map((p) => p.originalName)).toEqual([
        'M42.png',
      ]);
    });

    it('counts only the photos whose picture is in the package', async () => {
      const a = await sender();
      const b = await makeSet();
      const files = (await packageOf(a)).filter(([name]) => name !== 'images/p1.jpg');
      expect(await b.sharedSkies.inspect(memoryReader(files))).toMatchObject({
        photoCount: 1,
        bytes: 8,
      });
    });
  });
});

describe('shared sky rules', () => {
  it('names the package file after the sender, without characters a file name cannot hold', () => {
    expect(shareFileName('Paul')).toBe('Paul.myastrosky');
    expect(shareFileName('  Paul / Marie: le ciel?  ')).toBe('Paul - Marie- le ciel.myastrosky');
    expect(shareFileName('...')).toBe('sky.myastrosky');
    expect(shareFileName('')).toBe('sky.myastrosky');
  });

  it('cleans a display name', () => {
    expect(cleanSkyName('  Paul\n\tD.  ')).toBe('PaulD.');
    expect(cleanSkyName('x'.repeat(200))).toHaveLength(60);
    expect(cleanSkyName(42)).toBe('');
  });

  it('compares package dates as dates', () => {
    expect(sharedSkyStatus('2026-03-01T10:00:00.000Z')).toBe('new');
    expect(sharedSkyStatus('2026-03-01T10:00:00Z', '2026-03-01T10:00:00.000Z')).toBe('same');
    expect(sharedSkyStatus('2026-03-02T00:00:00Z', '2026-03-01T10:00:00.000Z')).toBe('update');
    expect(sharedSkyStatus('2026-02-02T00:00:00Z', '2026-03-01T10:00:00.000Z')).toBe('older');
  });

  it('cleans what a manifest holds, since it comes from someone else', () => {
    const manifest = parseShareManifest({
      kind: 'shared-sky',
      formatVersion: 2,
      skyId: 'abcdef12-3456',
      senderName: '  Paul  ',
      sharedAt: '2026-03-01T10:00:00Z',
      poiCategories: [{ id: 'c', name: 'Comet', color: 'javascript:alert(1)' }, { id: 'd' }],
      photos: [
        {
          id: 'p1',
          file: 'p1.jpg',
          width: 10,
          height: 20,
          quarterTurns: 7,
          notes: 5,
          dsoIds: ['M31', 4],
          correspondences: [
            { pointIndex: 0, photoX: 1, photoY: 2, starHip: 3 },
            { pointIndex: 'x' },
          ],
          manualPlacement: { centerRa: 'east' },
          gear: { telescope: 'Sky 80ED', camera: 12 },
          gearSetupId: 'setup-1',
        },
        { id: 'p2', file: 'p2.jpg', width: 0, height: 20 },
        { id: 'p3', file: 'P1.JPG', width: 10, height: 20 },
        'not a photo',
      ],
    });
    expect(manifest.senderName).toBe('Paul');
    expect(manifest.sharedAt).toBe('2026-03-01T10:00:00.000Z');
    expect(manifest.poiCategories).toEqual([{ id: 'c', name: 'Comet', color: '#888888' }]);
    expect(manifest.photos).toHaveLength(1);
    expect(manifest.photos[0]).toEqual({
      id: 'p1',
      file: 'p1.jpg',
      bytes: 0,
      originalName: 'p1.jpg',
      width: 10,
      height: 20,
      quarterTurns: 0,
      correspondences: [{ pointIndex: 0, photoX: 1, photoY: 2, starHip: 3, starName: '' }],
      dsoIds: ['M31'],
      labels: [],
      notes: '',
      pointsOfInterest: [],
      observationDate: null,
      integrations: [],
      // Written without its author (an earlier package): the sender's.
      author: 'Paul',
      gear: { telescope: 'Sky 80ED' },
    });
  });

  it('refuses a manifest with a bad sky id or date', () => {
    const base = {
      kind: 'shared-sky',
      formatVersion: 2,
      sharedAt: '2026-03-01T10:00:00Z',
      photos: [],
    };
    for (const bad of [
      { ...base, skyId: '../x' },
      { ...base, skyId: 'short' },
      { ...base, skyId: 'abcdef12-3456', sharedAt: 'yesterday' },
      { ...base, skyId: 'abcdef12-3456', photos: 'none' },
      { ...base, skyId: 'abcdef12-3456', formatVersion: 0 },
      null,
      [],
    ]) {
      expect(() => parseShareManifest(bad)).toThrow(/not a shared sky/);
    }
  });
});
