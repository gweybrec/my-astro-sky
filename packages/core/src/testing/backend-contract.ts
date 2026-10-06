/**
 * What every `Backend` must do, as plain data: a list of named cases that need no test runner (they
 * throw on failure), so the same cases run under Vitest against the HTTP backend and, later, inside
 * the phone's WebView against the local one. `tests/helpers/backend-contract.ts` turns them into
 * Vitest tests.
 *
 * The cases share one backend unless they ask for an isolated one, so each of them starts from "nothing
 * stored" in the tables it touches (plans, photos, set-ups, custom gear, DSO corrections, sky regions)
 * and leaves them that way. The point-of-interest categories hold the defaults of a new install, so
 * their case compares with the list it found. A case never depends on a generated identifier, on a
 * clock or on the order of the keys of an object.
 */
import type { Backend, CancelSignal, FileSource } from '../backend';
import { ERROR_CODES } from '../domain/error-codes';
import type { ObservationWindow } from '../domain/plans';
import type { Photo } from '../types';

/** The sites a backend reaches out to. */
export type ContractNetworkSite = 'skybot' | 'tns' | 'comets' | 'version';

/** What the cases cannot build themselves in core. */
export interface ContractFixtures {
  /** A small JPEG (64 x 48 pixels), named `contract.jpg`. */
  jpeg(): FileSource;
  /** A 40 x 30 FITS file whose header holds a solution (0.1 degree per pixel) over the field centred on RA 330.21217, Dec 73.08178. It carries DATE-OBS 2025-09-04T21:30:00 (read back as ...00Z), EXPTIME 300, STACKCNT 12 and FILTER Ha. */
  fits(): FileSource;
  /** A text file: neither a picture nor a solved file. */
  text(): FileSource;
  /** The file the last `backup.exportToUser` handed to the user (the backend's save hook), once it is complete. */
  lastExport(): Promise<FileSource | undefined>;
  /**
   * Present when the backend's outgoing requests are answered by recorded files: SkyBoT with the cone of
   * NGC 4438, TNS with the cone of NGC 7331, the MPC's `CometEls.txt` sample and a GitHub release `v9.9.9`.
   * `answer` replaces what a site says (until the next case starts); `undefined` restores the recording.
   */
  network?: {
    answer(site: ContractNetworkSite, answer: ContractNetworkAnswer | undefined): void;
  };
}

/** What a site answers instead of its recording. */
export interface ContractNetworkAnswer {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface ContractSetup {
  backend: Backend;
  fixtures: ContractFixtures;
}

/** Gives a backend with nothing stored (see the top of this file); `isolated` asks for one of its own, with its own storage. */
export type MakeBackend = (options?: { isolated?: boolean }) => Promise<ContractSetup>;

export interface BackendContractCase {
  name: string;
  run(): Promise<void>;
}

// ─── Assertions ──────────────────────────────────────────────────────────────

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Deep equality that, like Vitest's `toEqual`, ignores keys whose value is `undefined`. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) {
    if (ao[key] === undefined && bo[key] === undefined) continue;
    if (!deepEqual(ao[key], bo[key])) return false;
  }
  return true;
}

function fail(message: string): never {
  throw new Error(message);
}

function expectEqual(actual: unknown, expected: unknown, what: string): void {
  if (!deepEqual(actual, expected)) {
    fail(`${what}: expected ${show(expected)} but got ${show(actual)}`);
  }
}

function expectTrue(condition: boolean, what: string): void {
  if (!condition) fail(`${what}: expected true`);
}

/** What a `DomainError` carries, read without needing the class (the backend may have been loaded twice). */
interface ErrorShape {
  name?: unknown;
  kind?: unknown;
  code?: unknown;
}

/** The promise must reject with a `DomainError` of this kind and code. */
async function expectDomainError(
  promise: Promise<unknown>,
  kind: string,
  code: string,
  what: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  if (caught === undefined) fail(`${what}: expected a ${kind} error ${code}, but it resolved`);
  const e = caught as ErrorShape;
  if (typeof e !== 'object' || e === null || typeof e.kind !== 'string') {
    fail(`${what}: expected a DomainError, got ${show(String(caught))}`);
  }
  if (e.kind !== kind || e.code !== code) {
    fail(`${what}: expected ${kind} ${code}, got ${String(e.kind)} ${String(e.code)}`);
  }
}

/** The promise must reject with the `AbortError` of a cancelled transfer. */
async function expectAborted(promise: Promise<unknown>, what: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    if ((e as ErrorShape | null)?.name === 'AbortError') return;
    fail(`${what}: expected an AbortError, got ${show(String(e))}`);
  }
  fail(`${what}: expected an AbortError, but it resolved`);
}

/** A signal that is already cancelled. */
const cancelledSignal: CancelSignal = {
  aborted: true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

/** A photo without what changes between runs (its dates). */
function stable(photo: Photo): Record<string, unknown> {
  const { createdAt: _createdAt, ...rest } = photo;
  return rest;
}

const CORRESPONDENCES = [
  { pointIndex: 0, photoX: 1, photoY: 2, starHip: 32349, starName: 'Sirius' },
  { pointIndex: 1, photoX: 20, photoY: 15, starHip: 27989, starName: '' },
];

const WINDOW: ObservationWindow = {
  id: 'window-1',
  startFrac: 0.25,
  endFrac: 0.5,
  filter: 'Ha',
  color: null,
  frameSeconds: 120,
  snap: true,
};

// ─── The cases ───────────────────────────────────────────────────────────────

export function backendContractCases(makeBackend: MakeBackend): BackendContractCase[] {
  const cases: BackendContractCase[] = [];
  const add = (name: string, run: () => Promise<void>) => cases.push({ name, run });

  // ── Night plans ──────────────────────────────────────────────────────────

  add('plans: a full life cycle (plans, entries, mosaics, order)', async () => {
    const { backend: b } = await makeBackend();
    expectEqual(await b.plans.list(), [], 'a new backend has no plan');

    const a = (await b.plans.create({ name: 'A' })).id;
    const c = (await b.plans.create({ name: 'C' })).id;
    const plan = (id: string, name: string, position: number, extra: object = {}) => ({
      id,
      name,
      position,
      nightOf: null,
      setupId: null,
      lat: null,
      lon: null,
      sortBy: 'transit',
      entries: [],
      mosaics: [],
      ...extra,
    });
    expectEqual(await b.plans.list(), [plan(a, 'A', 0), plan(c, 'C', 1)], 'two new plans');

    await b.plans.reorder([c, a]);
    expectEqual(await b.plans.list(), [plan(c, 'C', 0), plan(a, 'A', 1)], 'plans reordered');

    await b.plans.update(a, {
      name: 'A2',
      nightOf: '2026-10-06',
      lat: 45.5,
      lon: 5.25,
      sortBy: 'name',
    });
    const settings = { nightOf: '2026-10-06', lat: 45.5, lon: 5.25, sortBy: 'name' };
    expectEqual(
      await b.plans.list(),
      [plan(c, 'C', 0), plan(a, 'A2', 1, settings)],
      'plan settings changed',
    );

    // Entries: a catalogue target and a custom frame.
    const e1 = (await b.plans.addEntry(a, { dsoId: 'M31' })).id;
    const e2 = (await b.plans.addEntry(a, { ra: 10, dec: 20, paDeg: 5 })).id;
    const entry = (id: string, position: number, extra: object) => ({
      id,
      dsoId: null,
      position,
      paDeg: null,
      ra: null,
      dec: null,
      notes: null,
      mosaicId: null,
      mosaicWDeg: null,
      mosaicHDeg: null,
      observationWindows: [],
      ...extra,
    });
    const planWith = async () => (await b.plans.list()).find((p) => p.id === a)!;
    expectEqual(
      (await planWith()).entries,
      [entry(e1, 0, { dsoId: 'M31' }), entry(e2, 1, { ra: 10, dec: 20, paDeg: 5 })],
      'two entries',
    );

    await b.plans.reorderEntries(a, [e2, e1]);
    expectEqual(
      (await planWith()).entries,
      [entry(e2, 0, { ra: 10, dec: 20, paDeg: 5 }), entry(e1, 1, { dsoId: 'M31' })],
      'entries reordered',
    );

    await b.plans.updateEntry(e1, { paDeg: 30, mosaicWDeg: 3.5, observationWindows: [WINDOW] }, a);
    await b.plans.updateEntry(e2, { ra: 11, dec: null }, a);
    expectEqual(
      (await planWith()).entries,
      [
        entry(e2, 0, { ra: 11, dec: null, paDeg: 5 }),
        entry(e1, 1, { dsoId: 'M31', paDeg: 30, mosaicWDeg: 3.5, observationWindows: [WINDOW] }),
      ],
      'entries changed',
    );

    await b.plans.removeEntry(e2, a);
    expectEqual(
      (await planWith()).entries,
      // the entries that stay keep their position: there is no renumbering
      [entry(e1, 1, { dsoId: 'M31', paDeg: 30, mosaicWDeg: 3.5, observationWindows: [WINDOW] })],
      'an entry removed',
    );

    // Mosaics: the tiles are entries of the plan.
    const mosaicParams = (cols: number, rows: number, tiles: number) => ({
      dsoId: null,
      name: 'Mosaic',
      centerRa: 10,
      centerDec: 20,
      paDeg: 0,
      overlapPct: 10,
      cols,
      rows,
      tiles: Array.from({ length: tiles }, (_, i) => ({ ra: 10 + i, dec: 20, paDeg: null })),
    });
    const m = (await b.plans.createMosaic(a, mosaicParams(2, 1, 2))).id;
    let current = await planWith();
    const tiles = current.entries.filter((e) => e.mosaicId === m);
    expectEqual(
      tiles.map((t) => [t.ra, t.dec]),
      [
        [10, 20],
        [11, 20],
      ],
      'the tiles of a new mosaic',
    );
    expectEqual(
      current.mosaics,
      [
        {
          id: m,
          dsoId: null,
          name: 'Mosaic',
          centerRa: 10,
          centerDec: 20,
          paDeg: 0,
          overlapPct: 10,
          cols: 2,
          rows: 1,
          position: 0,
        },
      ],
      'a new mosaic',
    );

    await b.plans.updateMosaic(a, m, { ...mosaicParams(1, 3, 3), name: 'Mosaic 2' });
    current = await planWith();
    expectEqual(
      current.entries.filter((e) => e.mosaicId === m).map((t) => [t.ra, t.dec]),
      [
        [10, 20],
        [11, 20],
        [12, 20],
      ],
      'the tiles of a changed mosaic',
    );
    expectEqual(
      current.mosaics.map((x) => [x.name, x.cols, x.rows]),
      [['Mosaic 2', 1, 3]],
      'a changed mosaic',
    );

    await b.plans.removeMosaic(a, m);
    current = await planWith();
    expectEqual(current.mosaics, [], 'the mosaic is gone');
    expectEqual(
      current.entries.map((e) => e.id),
      [e1],
      'its tiles are gone',
    );

    await b.plans.remove(a);
    await b.plans.remove(c);
    expectEqual(await b.plans.list(), [], 'every plan removed');
  });

  // ── Gear ─────────────────────────────────────────────────────────────────

  add('gear set-ups: a full life cycle', async () => {
    const { backend: b } = await makeBackend();
    expectEqual(await b.gear.listSetups(), [], 'a new backend has no set-up');
    const telescope = (await b.gear.listCatalog('telescope'))[0] as { id: string };
    const camera = (await b.gear.listCatalog('camera'))[0] as { id: string };
    const accessory = (await b.gear.listCatalog('accessory'))[0] as { id: string };

    const first = (
      await b.gear.createSetup({
        name: 'First',
        telescopeId: telescope.id,
        cameraId: camera.id,
        accessoryId: null,
        enabled: true,
      })
    ).id;
    const second = (
      await b.gear.createSetup({
        name: 'Second',
        telescopeId: telescope.id,
        cameraId: camera.id,
        accessoryId: accessory.id,
        enabled: true,
      })
    ).id;
    const setup = (id: string, name: string, accessoryId: string | null, enabled = true) => ({
      id,
      name,
      telescopeId: telescope.id,
      cameraId: camera.id,
      accessoryId,
      enabled,
    });
    const listed = async () =>
      [...(await b.gear.listSetups())].sort((x, y) => x.name.localeCompare(y.name));
    expectEqual(
      await listed(),
      [setup(first, 'First', null), setup(second, 'Second', accessory.id)],
      'two set-ups',
    );

    await b.gear.replaceSetup(first, {
      name: 'First renamed',
      telescopeId: telescope.id,
      cameraId: camera.id,
      accessoryId: accessory.id,
      enabled: true,
    });
    await b.gear.setSetupEnabled(second, false);
    expectEqual(
      await listed(),
      [setup(first, 'First renamed', accessory.id), setup(second, 'Second', accessory.id, false)],
      'set-ups changed',
    );

    await b.gear.removeSetup(first);
    expectEqual(await listed(), [setup(second, 'Second', accessory.id, false)], 'one removed');
    expectEqual(await b.gear.removeAllSetups(), 1, 'removeAllSetups counts what it removed');
    expectEqual(await b.gear.listSetups(), [], 'every set-up removed');
  });

  add('custom gear: add, list in its own catalogue, remove', async () => {
    const { backend: b } = await makeBackend();
    const types = ['telescope', 'camera', 'accessory', 'filter'] as const;
    const ids: Record<string, string> = {};
    for (const type of types) {
      ids[type] = (await b.gear.addCustom(type, { brand: 'Contract', model: type, size: 3 })).id;
    }
    for (const type of types) {
      const catalogue = (await b.gear.listCatalog(type)) as { id: string }[];
      const own = catalogue.filter((item) => item.id.length > 0 && item.id === ids[type]);
      expectEqual(
        own,
        [{ id: ids[type], brand: 'Contract', model: type, size: 3 }],
        `the custom ${type} in its catalogue`,
      );
      for (const other of types.filter((t) => t !== type)) {
        const elsewhere = ((await b.gear.listCatalog(other)) as { id: string }[]).some(
          (item) => item.id === ids[type],
        );
        expectTrue(!elsewhere, `the custom ${type} is not in the ${other} catalogue`);
      }
    }
    await b.gear.removeCustom(ids.telescope);
    const telescopes = (await b.gear.listCatalog('telescope')) as { id: string }[];
    expectTrue(
      !telescopes.some((t) => t.id === ids.telescope),
      'a removed custom telescope is gone',
    );
    expectEqual(await b.gear.removeAllCustom(), 3, 'removeAllCustom counts what it removed');
    const filters = (await b.gear.listCatalog('filter')) as { id: string }[];
    expectTrue(!filters.some((f) => f.id === ids.filter), 'every custom item removed');
  });

  // ── DSO corrections, point-of-interest categories, sky regions ───────────

  add('DSO corrections: a full life cycle', async () => {
    const { backend: b } = await makeBackend();
    expectEqual(await b.dsoOverrides.getAll(), {}, 'a new backend has no correction');
    await b.dsoOverrides.upsert('M31', { names: { en: 'Andromeda', fr: 'Andromède' }, rating: 5 });
    await b.dsoOverrides.upsert('NGC7000', { ra: 314.7, dec: 44.3, constellation: 'Cyg' });
    expectEqual(
      await b.dsoOverrides.getAll(),
      {
        M31: { names: { en: 'Andromeda', fr: 'Andromède' }, rating: 5 },
        NGC7000: { ra: 314.7, dec: 44.3, constellation: 'Cyg' },
      },
      'two corrections',
    );
    await b.dsoOverrides.upsert('M31', { rating: 3 });
    expectEqual(
      (await b.dsoOverrides.getAll()).M31,
      { rating: 3 },
      'a correction is replaced, not merged',
    );
    await b.dsoOverrides.remove('M31');
    expectEqual(
      await b.dsoOverrides.getAll(),
      { NGC7000: { ra: 314.7, dec: 44.3, constellation: 'Cyg' } },
      'one correction removed',
    );
    expectEqual(await b.dsoOverrides.removeAll(), 1, 'removeAll counts what it removed');
    expectEqual(await b.dsoOverrides.getAll(), {}, 'every correction removed');
  });

  add('point-of-interest categories: a full life cycle', async () => {
    const { backend: b } = await makeBackend();
    const before = await b.poiCategories.list();
    const id = (await b.poiCategories.create({ name: 'Contract', color: '#112233' })).id;
    expectEqual(
      await b.poiCategories.list(),
      [...before, { id, name: 'Contract', color: '#112233', position: before.length }],
      'a category added at the end',
    );
    await b.poiCategories.update(id, { name: 'Contract 2', color: '#445566' });
    expectEqual(
      await b.poiCategories.list(),
      [...before, { id, name: 'Contract 2', color: '#445566', position: before.length }],
      'a category changed',
    );
    await b.poiCategories.remove(id);
    expectEqual(await b.poiCategories.list(), before, 'a category removed');
  });

  add('sky regions: a full life cycle', async () => {
    const { backend: b } = await makeBackend();
    expectEqual(await b.skyRegions.list(), [], 'a new backend has no region');
    const points = [
      { azDeg: 10, altDeg: 20 },
      { azDeg: 50, altDeg: 20 },
      { azDeg: 50, altDeg: 70 },
    ];
    const id = (await b.skyRegions.create({ name: 'Roof', color: '#ff0000', points })).id;
    expectEqual(
      await b.skyRegions.list(),
      [{ id, name: 'Roof', color: '#ff0000', points, position: 0 }],
      'a region added',
    );
    const moved = [...points, { azDeg: 10, altDeg: 70 }];
    await b.skyRegions.update(id, { name: 'Roof 2', points: moved });
    expectEqual(
      await b.skyRegions.list(),
      [{ id, name: 'Roof 2', color: '#ff0000', points: moved, position: 0 }],
      'a region changed',
    );
    await b.skyRegions.remove(id);
    expectEqual(await b.skyRegions.list(), [], 'a region removed');
  });

  // ── Photos ───────────────────────────────────────────────────────────────

  add('photos: upload, list with size, metadata, placement, order, removal', async () => {
    const { backend: b, fixtures } = await makeBackend();
    expectEqual(await b.photos.listWithSizes(), [], 'a new backend has no photo');

    const progress: number[] = [];
    const first = await b.photos.upload(
      fixtures.jpeg(),
      { correspondences: JSON.stringify(CORRESPONDENCES), notes: 'first', dsoIds: '["M31"]' },
      { onProgress: (f) => progress.push(f) },
    );
    expectTrue(
      progress.every((f) => f >= 0 && f <= 1),
      'the progress is a fraction from 0 to 1',
    );
    expectEqual(first.filename, `${first.id}.jpg`, 'the stored file is named after the photo');
    expectEqual(
      stable(first),
      {
        id: first.id,
        filename: `${first.id}.jpg`,
        originalName: 'contract.jpg',
        width: 64,
        height: 48,
        dsoIds: ['M31'],
        labels: [],
        pointsOfInterest: [],
        notes: 'first',
        integrations: [],
        observationDate: null,
        captureDetails: {},
        gearSetupId: null,
        thumbFilename: `${first.id}_thumb.jpg`,
        correspondences: CORRESPONDENCES,
      },
      'the photo an upload returns',
    );
    const second = await b.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify(CORRESPONDENCES),
    });

    const listed = await b.photos.listWithSizes();
    expectEqual(
      listed.map((p) => p.id),
      [first.id, second.id],
      'photos listed in upload order',
    );
    for (const p of listed) {
      expectTrue(
        typeof p.fileSize === 'number' && p.fileSize > 0,
        'the list carries the file size',
      );
    }
    const { fileSize: _size, ...firstListed } = listed[0];
    expectEqual(
      stable(firstListed as Photo),
      stable(first),
      'the listed photo is the uploaded one',
    );

    const changed = await b.photos.updateMetadata(first.id, {
      dsoIds: ['M42'],
      labels: ['nebula'],
      notes: 'changed',
      originalName: 'renamed.jpg',
      observationDate: '2026-01-02T03:04:05Z',
    });
    expectEqual(changed, { originalName: 'renamed.jpg' }, 'the display name an update returns');
    const afterMetadata = (await b.photos.listWithSizes())[0];
    expectEqual(
      [
        afterMetadata.dsoIds,
        afterMetadata.labels,
        afterMetadata.notes,
        afterMetadata.originalName,
        afterMetadata.observationDate,
      ],
      [['M42'], ['nebula'], 'changed', 'renamed.jpg', '2026-01-02T03:04:05Z'],
      'the metadata changed',
    );

    const placement = {
      centerRa: 10.5,
      centerDec: -20.25,
      rotationDeg: 33,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: true,
    };
    await b.photos.setManualPlacement(first.id, placement);
    expectEqual(
      (await b.photos.listWithSizes())[0].manualPlacement,
      placement,
      'a manual placement saved',
    );
    await b.photos.setManualPlacement(first.id, null);
    expectEqual(
      (await b.photos.listWithSizes())[0].manualPlacement ?? null,
      null,
      'a manual placement cleared',
    );

    await b.photos.setOrder([second.id, first.id]);
    expectEqual(
      (await b.photos.listWithSizes()).map((p) => p.id),
      [second.id, first.id],
      'the draw order changed',
    );

    await b.photos.remove(second.id);
    expectEqual(
      (await b.photos.listWithSizes()).map((p) => p.id),
      [first.id],
      'a photo removed',
    );
    const third = await b.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify(CORRESPONDENCES),
    });
    expectEqual(await b.photos.removeMany([first.id, third.id]), 2, 'removeMany counts');
    expectEqual(await b.photos.listWithSizes(), [], 'photos removed in bulk');

    await b.photos.upload(fixtures.jpeg(), { correspondences: JSON.stringify(CORRESPONDENCES) });
    await b.photos.upload(fixtures.jpeg(), { correspondences: JSON.stringify(CORRESPONDENCES) });
    expectEqual(await b.photos.removeAll(), 2, 'removeAll counts');
    expectEqual(await b.photos.listWithSizes(), [], 'every photo removed');
  });

  add('files: an address for a stored file and for the star catalogue', async () => {
    const { backend: b } = await makeBackend();
    const url = b.files.url('abc_thumb.jpg');
    expectTrue(url.endsWith('abc_thumb.jpg'), 'the address of a file ends with its name');
    const catalogue = await b.catalog.starCatalogUrl();
    expectTrue(
      typeof catalogue === 'string' && catalogue.endsWith('.json'),
      'the star catalogue is a JSON file',
    );
  });

  // ── Settings ─────────────────────────────────────────────────────────────

  add('settings: read, change, set and remove the API key', async () => {
    const { backend: b } = await makeBackend();
    const read = async () => {
      const { isWindows, ...rest } = await b.settings.readPublic();
      expectEqual(typeof isWindows, 'boolean', 'isWindows is a boolean');
      return rest;
    };
    const blank = {
      apiKeySet: false,
      ASTAP_PATH: '',
      SOLVE_FIELD_PATH: '',
      ASTROMETRY_DATA_DIR: '',
      MAX_PARALLEL_SOLVES: '',
      USE_WSL_FOR_SOLVE_FIELD: false,
      USE_WSL_FOR_ASTAP: false,
    };
    expectEqual(await read(), blank, 'the settings of a new backend');
    try {
      expectEqual(
        await b.settings.update({
          ASTAP_PATH: '/opt/astap',
          ASTROMETRY_DATA_DIR: '/data/index',
          MAX_PARALLEL_SOLVES: '2',
          USE_WSL_FOR_ASTAP: true,
        }),
        { apiKeyChanged: false },
        'no key was written',
      );
      expectEqual(
        await read(),
        {
          ...blank,
          ASTAP_PATH: '/opt/astap',
          ASTROMETRY_DATA_DIR: '/data/index',
          MAX_PARALLEL_SOLVES: '2',
          USE_WSL_FOR_ASTAP: true,
        },
        'the settings changed',
      );
      expectEqual(
        await b.settings.update({ apiKey: 'contract-key' }),
        { apiKeyChanged: true },
        'a key was written',
      );
      expectEqual((await read()).apiKeySet, true, 'the key is set, and never returned');
    } finally {
      await b.settings.removeApiKey();
      await b.settings.update({
        ASTAP_PATH: '',
        ASTROMETRY_DATA_DIR: '',
        MAX_PARALLEL_SOLVES: '',
        USE_WSL_FOR_ASTAP: false,
      });
    }
    expectEqual(await read(), blank, 'the settings are back to blank');
  });

  // ── Stars ────────────────────────────────────────────────────────────────

  add('stars: search by name, nearby, by number', async () => {
    const { backend: b } = await makeBackend();
    const found = await b.stars.search('sirius', 5);
    expectEqual(
      [found[0]?.hip, found[0]?.name, found[0]?.bayer, found[0]?.constellation, found[0]?.label],
      [32349, 'Sirius', 'α', 'CMa', 'Sirius (α CMa)'],
      'the first star found for "sirius"',
    );
    const near = await b.stars.nearby({
      ra: 101.2872,
      dec: -16.7161,
      radius: 2,
      magLimit: 5,
      limit: 5,
    });
    expectTrue(
      near.some((s) => s.hip === 32349),
      'Sirius is near its own position',
    );
    expectTrue(
      near.every((s) => s.mag <= 5),
      'nearby stars respect the magnitude limit',
    );
    const star = await b.stars.getByHip(32349);
    expectEqual(
      [star.hip, star.name, star.ra, star.dec],
      [32349, 'Sirius', 101.2872, -16.7161],
      'a star by number',
    );
    expectEqual(
      (star as unknown as Record<string, unknown>).label,
      undefined,
      'no label on a star',
    );
  });

  // ── Solved files ─────────────────────────────────────────────────────────

  add('solved files: read the solution of a FITS file, and convert it', async () => {
    const { backend: b, fixtures } = await makeBackend();
    const solved = await b.solvedImport.solveWcs(fixtures.fits());
    if (!solved.success) fail(`the solution of the FITS file: got ${show(solved)}`);
    expectEqual(
      [
        solved.sourceWidth,
        solved.sourceHeight,
        solved.dateObs,
        solved.expTime,
        solved.stackCnt,
        solved.filter,
      ],
      [40, 30, '2025-09-04T21:30:00Z', 300, 12, 'Ha'],
      'what the header says',
    );
    expectTrue(solved.correspondences.length >= 3, 'the file matches at least 3 catalogue stars');
    for (const c of solved.correspondences) {
      expectTrue(
        c.photoX >= 0 && c.photoX <= 40 && c.photoY >= 0 && c.photoY <= 30,
        'a correspondence lies inside the picture',
      );
    }

    const scaled = await b.solvedImport.solveWcs(fixtures.fits(), { width: 80, height: 60 });
    if (!scaled.success) fail(`the rescaled solution: got ${show(scaled)}`);
    expectEqual(
      scaled.dimensionWarning,
      { sourceW: 40, sourceH: 30, targetW: 80, targetH: 60, aspectMismatch: false },
      'the rescale is reported',
    );

    const converted = await b.solvedImport.convert(fixtures.fits());
    expectEqual(
      [
        converted.success,
        converted.width,
        converted.height,
        converted.sourceWidth,
        converted.filter,
      ],
      [true, 40, 30, 40, 'Ha'],
      'the converted file',
    );
    expectEqual(
      Array.from(converted.png.slice(0, 8)),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'the picture is a PNG',
    );
    expectEqual(
      (converted.correspondences ?? []).length,
      solved.correspondences.length,
      'both read the same solution',
    );
  });

  add('solved files: a file that is not FITS or TIFF is refused', async () => {
    const { backend: b, fixtures } = await makeBackend();
    await expectDomainError(
      b.solvedImport.solveWcs(fixtures.text()),
      'invalid',
      'UNSUPPORTED_FORMAT',
      'solveWcs of a text file',
    );
    await expectDomainError(
      b.solvedImport.convert(fixtures.text()),
      'invalid',
      'UNSUPPORTED_FORMAT',
      'convert of a text file',
    );
  });

  add('solved files: a conversion can be cancelled', async () => {
    const { backend: b, fixtures } = await makeBackend();
    await expectAborted(
      b.solvedImport.convert(fixtures.fits(), { cancel: cancelledSignal }),
      'convert with a cancelled signal',
    );
  });

  // ── Backup ───────────────────────────────────────────────────────────────

  add('backup: export, preview, and restore into an empty backend', async () => {
    const { backend: b, fixtures } = await makeBackend();
    const planId = (await b.plans.create({ name: 'Backed up' })).id;
    await b.plans.addEntry(planId, { dsoId: 'M31' });
    await b.photos.upload(fixtures.jpeg(), {
      correspondences: JSON.stringify(CORRESPONDENCES),
      notes: 'kept',
    });
    await b.gear.addCustom('telescope', { brand: 'Contract', model: 'Scope' });
    await b.dsoOverrides.upsert('M31', { rating: 4 });
    const regionPoints = [
      { azDeg: 1, altDeg: 2 },
      { azDeg: 3, altDeg: 2 },
      { azDeg: 3, altDeg: 9 },
    ];
    await b.skyRegions.create({ name: 'Backed up region', color: '#00ff00', points: regionPoints });

    try {
      await b.backup.exportToUser({
        options: {
          includeImages: true,
          includeMetadata: true,
          includeDsoOverrides: true,
          includeCustomGear: true,
          includeSetups: true,
          includePlans: true,
          includePoiCategories: true,
          includeSkyRegions: true,
        },
        ids: [],
      });
      const file = await fixtures.lastExport();
      if (!file) fail('the export was not handed to the user');
      expectTrue(/\.zip$/.test(file.name), 'the export is a ZIP file');

      const preview = await b.backup.preview(file);
      expectEqual(
        [
          preview.hasMetadata,
          preview.photos,
          preview.hasDsoOverrides,
          preview.hasCustomGear,
          preview.hasPlans,
          preview.hasSkyRegions,
        ],
        [true, 1, true, true, true, true],
        'what the export holds',
      );
      expectEqual(
        preview.images.map((i) => [i.originalName, i.exists]),
        [['contract.jpg', true]],
        'the pictures of the export, already here',
      );
      expectEqual(
        preview.plans.map((p) => [p.id, p.name, p.exists]),
        [[planId, 'Backed up', true]],
        'the plans of the export, already here',
      );

      const other = await makeBackend({ isolated: true });
      const o = other.backend;
      expectEqual(await o.plans.list(), [], 'the second backend has no plan');
      expectEqual(await o.photos.listWithSizes(), [], 'the second backend has no photo');
      const there = await o.backup.preview(file);
      expectEqual(
        [there.photos, there.images.map((i) => i.exists), there.plans.map((p) => p.exists)],
        [1, [false], [false]],
        'the export is new to the second backend',
      );

      const result = await o.backup.restore(file, {
        importMetadata: true,
        importDsoOverrides: true,
        importPoiCategories: true,
        importSkyRegions: true,
        selectedImages: preview.images.map((i) => i.filename),
        selectedPlans: preview.plans.map((p) => p.id),
        selectedSetups: [],
        selectedGear: preview.gear.map((g) => g.id),
        setupConflicts: {},
      });
      expectEqual(
        [result.imported >= 1, result.skipped, result.failed ?? []],
        [true, 0, []],
        'the import result',
      );

      const restoredPlans = await o.plans.list();
      expectEqual(
        restoredPlans.map((p) => [p.name, p.entries.map((e) => e.dsoId)]),
        [['Backed up', ['M31']]],
        'the plan restored',
      );
      const restoredPhotos = await o.photos.listWithSizes();
      expectEqual(
        restoredPhotos.map((p) => [p.originalName, p.notes, p.width, p.height]),
        [['contract.jpg', 'kept', 64, 48]],
        'the photo restored',
      );
      expectEqual(
        restoredPhotos[0].correspondences,
        CORRESPONDENCES,
        'the correspondences restored',
      );
      expectEqual(await o.dsoOverrides.getAll(), { M31: { rating: 4 } }, 'the correction restored');
      expectEqual(
        (await o.skyRegions.list()).map((r) => [r.name, r.color, r.points]),
        [['Backed up region', '#00ff00', regionPoints]],
        'the region restored',
      );
      const telescopes = (await o.gear.listCatalog('telescope')) as {
        id: string;
        model?: string;
      }[];
      expectTrue(
        telescopes.some((t) => t.model === 'Scope'),
        'the custom telescope restored',
      );
    } finally {
      await b.gear.removeAllCustom();
    }
  });

  // ── Errors: one per kind ─────────────────────────────────────────────────

  add('errors: invalid, notFound and conflict carry their kind and code', async () => {
    const { backend: b, fixtures } = await makeBackend();
    await expectDomainError(
      b.plans.create({ name: '' }),
      'invalid',
      'PLAN_NAME_REQUIRED',
      'a plan without a name',
    );
    await expectDomainError(
      b.plans.remove('no-such-plan'),
      'notFound',
      'PLAN_NOT_FOUND',
      'an unknown plan',
    );
    const planId = (await b.plans.create({ name: 'Errors' })).id;
    await b.plans.addEntry(planId, { dsoId: 'M31' });
    await expectDomainError(
      b.plans.addEntry(planId, { dsoId: 'M31' }),
      'conflict',
      'DUPLICATE_ENTRY',
      'the same target twice',
    );
    await b.plans.remove(planId);
    await expectDomainError(
      b.photos.upload(
        { ...fixtures.jpeg(), name: 'contract.gif' },
        { correspondences: JSON.stringify(CORRESPONDENCES) },
      ),
      'invalid',
      'INVALID_EXTENSION',
      'a picture with an extension that is not allowed',
    );
    await expectDomainError(
      b.photos.remove('no-such-photo'),
      'notFound',
      'PHOTO_NOT_FOUND',
      'an unknown photo',
    );
    await expectDomainError(
      b.stars.getByHip(99999999),
      'notFound',
      'STAR_NOT_FOUND',
      'an unknown star',
    );
    await expectDomainError(
      b.stars.getByHip(Number.NaN),
      'invalid',
      'INVALID_HIP',
      'a star number that is not one',
    );
  });

  // ── Network-backed members ───────────────────────────────────────────────

  add('horizon: a latitude out of range is refused', async () => {
    const { backend: b } = await makeBackend();
    await expectDomainError(
      b.horizon.getProfile({ lat: 95, lon: 0 }),
      'invalid',
      'INVALID_LAT_LON',
      'latitude 95',
    );
  });

  add('identification: a cone out of range is refused', async () => {
    const { backend: b } = await makeBackend();
    await expectDomainError(
      b.identify.searchAsteroids({ raDeg: 400, decDeg: 0, radiusArcmin: 5, epochJd: 2461139.5 }),
      'invalid',
      'INVALID_PARAMS',
      'SkyBoT with RA 400',
    );
    await expectDomainError(
      b.identify.searchTransients({
        raDeg: 10,
        decDeg: 100,
        radiusArcmin: 5,
        dateStart: '2025-09-04',
        dateEnd: '2026-11-03',
      }),
      'invalid',
      'INVALID_PARAMS',
      'TNS with Dec 100',
    );
  });

  add('identification: asteroids, transients and comets from the recorded answers', async () => {
    const { backend: b, fixtures } = await makeBackend();
    if (!fixtures.network) return;
    const asteroids = await b.identify.searchAsteroids({
      raDeg: 186.9,
      decDeg: 13.0,
      radiusArcmin: 5,
      epochJd: 2461139.5,
    });
    const asteroid = asteroids.find((c) => c.number === '18799');
    expectEqual(asteroid?.name, '1999 JZ73', 'asteroid 18799 is in the cone');
    expectTrue(Math.abs((asteroid?.raDeg ?? 0) - 186.965976) < 1e-4, 'its position');

    const transients = await b.identify.searchTransients({
      raDeg: 339.2671,
      decDeg: 34.4159,
      radiusArcmin: 20,
      dateStart: '2025-09-04',
      dateEnd: '2026-11-03',
    });
    expectEqual(transients.length, 8, 'the transients of the cone');
    const sn = transients.find((c) => c.name === 'SN 2026aaiv');
    expectEqual(
      [sn?.classified, sn?.tnsUrl],
      [true, 'https://www.wis-tns.org/object/2026aaiv'],
      'SN 2026aaiv',
    );

    const comets = await b.identify.getCometElements();
    const tempel = comets.find((c) => c.designation === '10P');
    expectEqual(
      [tempel?.name, tempel?.e, tempel?.q],
      ['10P/Tempel', 0.537442, 1.41774],
      'comet 10P',
    );
  });

  add(
    'identification: an upstream failure is an upstream error, a TNS limit a rate limit',
    async () => {
      const { backend: b, fixtures } = await makeBackend();
      if (!fixtures.network) return;
      fixtures.network.answer('skybot', { status: 503, body: 'down for maintenance' });
      await expectDomainError(
        b.identify.searchAsteroids({ raDeg: 11, decDeg: 12, radiusArcmin: 5, epochJd: 2461140.5 }),
        'upstream',
        'SKYBOT_FAILED',
        'SkyBoT answering 503',
      );
      fixtures.network.answer('tns', {
        status: 429,
        body: '{"id_code":429}',
        headers: { 'x-cone-rate-limit-reset': '42' },
      });
      await expectDomainError(
        b.identify.searchTransients({
          raDeg: 10,
          decDeg: 20,
          radiusArcmin: 20,
          dateStart: '2025-09-04',
          dateEnd: '2026-11-03',
        }),
        'rateLimited',
        'TNS_RATE_LIMITED',
        'TNS answering 429',
      );
    },
  );

  add('version: the latest release from the recorded answer', async () => {
    const { backend: b, fixtures } = await makeBackend();
    if (!fixtures.network) return;
    expectEqual(
      await b.version.getLatest(),
      {
        version: 'v9.9.9',
        url: 'https://example.invalid/release/v9.9.9',
        publishedAt: '2026-01-02T03:04:05Z',
      },
      'the latest release',
    );
  });

  add('online solving: an unknown job and a missing key are refused', async () => {
    const { backend: b, fixtures } = await makeBackend();
    await expectDomainError(
      b.novaSolve.getJob('no-such-job'),
      'notFound',
      'JOB_NOT_FOUND',
      'an unknown job',
    );
    await expectDomainError(
      b.novaSolve.submit(fixtures.jpeg()),
      'invalid',
      'ASTROMETRY_NOT_CONFIGURED',
      'a submission without an API key',
    );
  });

  add('online solving: the list of past submissions and the reuse need a key too', async () => {
    const { backend: b, fixtures } = await makeBackend();
    await expectDomainError(
      b.novaSolve.listSubmissions(),
      'invalid',
      'ASTROMETRY_NOT_CONFIGURED',
      'the past submissions without an API key',
    );
    await expectDomainError(
      b.novaSolve.reuse(fixtures.jpeg(), 1),
      'invalid',
      'ASTROMETRY_NOT_CONFIGURED',
      'a reuse without an API key',
    );
  });

  add(
    'photos: a file that is not a picture is refused with a code that has a message',
    async () => {
      const { backend: b, fixtures } = await makeBackend();
      let caught: unknown;
      try {
        await b.photos.upload(fixtures.text(), {
          correspondences: JSON.stringify(CORRESPONDENCES),
        });
      } catch (e) {
        caught = e;
      }
      if (caught === undefined) fail('a .txt file as a photo: expected a refusal, but it resolved');
      const e = caught as ErrorShape;
      expectEqual(e.kind, 'invalid', 'the kind of the refusal of a .txt file');
      // The server's upload filter refuses it for its type, the service for its extension.
      expectTrue(
        typeof e.code === 'string' && (ERROR_CODES as readonly string[]).includes(e.code),
        `the refusal carries a known code (got ${String(e.code)})`,
      );
    },
  );

  // ── Solvers installed next to the server ─────────────────────────────────

  add('local solvers: probes of nothing, unknown jobs, a file that cannot be solved', async () => {
    const { backend: b, fixtures } = await makeBackend();
    const solvers = b.localSolvers;
    if (!solvers) return;
    expectEqual(
      await solvers.probe('astap', { path: '', useWSL: false }),
      { ok: false, code: -1, stdout: '', stderr: '' },
      'the ASTAP probe of no path',
    );
    expectEqual(
      await solvers.probe('solve-field', { path: '', useWSL: false }),
      { ok: false, code: -1, stdout: '', stderr: '' },
      'the solve-field probe of no path',
    );
    expectEqual(
      await solvers.probe('data-dir', { dir: '', useWSL: false }),
      { ok: false, code: -1, output: '' },
      'the folder probe of no folder',
    );
    for (const solver of ['astap', 'solve-field'] as const) {
      await expectDomainError(
        solvers.poll(solver, 'no-such-job'),
        'notFound',
        'JOB_NOT_FOUND',
        `polling an unknown ${solver} job`,
      );
      await expectDomainError(
        solvers.cancel(solver, 'no-such-job'),
        'notFound',
        'JOB_NOT_FOUND',
        `cancelling an unknown ${solver} job`,
      );
      // An extension the solvers do not take: refused before any job starts.
      const gif = { ...fixtures.jpeg(), name: 'contract.gif' };
      await expectDomainError(
        solvers.submit(solver, gif),
        'invalid',
        'UNSUPPORTED_FORMAT',
        `submitting a .gif to ${solver}`,
      );
    }
  });

  return cases;
}
