// @vitest-environment node
/**
 * The gear service (WP2.3e) on a private in-memory database with a small fake catalogue.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import {
  customGearName,
  type CustomGearType,
  type GearCatalog,
} from '@myastrosky/core/domain/gear';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import { createGearService, type GearService } from '@myastrosky/core/services/gear';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const CATALOG: GearCatalog = {
  telescopes: [
    { id: 'tel-b', brand: 'Sky-Watcher', model: 'Esprit 100' },
    { id: 'tel-a', brand: 'Celestron', model: 'EdgeHD 8' },
  ],
  cameras: [{ id: 'cam-1', brand: 'ZWO', model: 'ASI294MC' }],
  accessories: [{ id: 'acc-1', brand: 'Optolong', model: 'Reducer' }],
  filters: [{ id: 'fil-1', brand: 'Optolong', model: 'L-eXtreme' }],
};

describe.each(SQL_ADAPTERS)('GearService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: GearService;
  let counter: number;

  const make = (catalog: GearCatalog = CATALOG): GearService =>
    createGearService({ db, newId: () => `id${++counter}`, catalog });

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = wrap(createBetterSqliteDb(conn));
    await initSchema(db);
    counter = 0;
    svc = make();
  });
  afterEach(() => conn.close());

  const rejection = async (p: Promise<unknown>): Promise<DomainError> => {
    try {
      await p;
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      return e as DomainError;
    }
    throw new Error('expected the promise to reject');
  };

  const customRows = () =>
    conn.prepare('SELECT id, type, data FROM custom_gear ORDER BY rowid').all() as {
      id: string;
      type: string;
      data: string;
    }[];

  const setup = {
    name: 'Main rig',
    telescopeId: 't1',
    cameraId: 'c1',
    accessoryId: 'a1',
    enabled: true,
  };

  describe('listCatalog', () => {
    it('returns the built-in items of the type, sorted by brand and model', async () => {
      expect(await svc.listCatalog('telescope')).toEqual([
        { id: 'tel-a', brand: 'Celestron', model: 'EdgeHD 8' },
        { id: 'tel-b', brand: 'Sky-Watcher', model: 'Esprit 100' },
      ]);
      expect(await svc.listCatalog('camera')).toEqual(CATALOG.cameras);
      expect(await svc.listCatalog('accessory')).toEqual(CATALOG.accessories);
      expect(await svc.listCatalog('filter')).toEqual(CATALOG.filters);
    });

    it('merges the custom items of that type only, in the sort order', async () => {
      const { id } = await svc.addCustom('telescope', { brand: 'Askar', model: 'FRA400' });
      await svc.addCustom('camera', { brand: 'Atik', model: 'Horizon' });
      const list = (await svc.listCatalog('telescope')) as { id: string }[];
      expect(list.map((t) => t.id)).toEqual([id, 'tel-a', 'tel-b']);
      expect(await svc.listCatalog('camera')).toHaveLength(2);
    });

    it('sorts an item without brand or model as an empty string', async () => {
      const bare = make({ ...CATALOG, accessories: [{ id: 'x' }, { id: 'y', brand: 'A' }] });
      expect(((await bare.listCatalog('accessory')) as { id: string }[]).map((a) => a.id)).toEqual([
        'x',
        'y',
      ]);
    });

    it('does not change the catalogue it was given', async () => {
      const before = JSON.stringify(CATALOG);
      await svc.addCustom('telescope', { brand: 'A', model: 'B' });
      await svc.listCatalog('telescope');
      expect(JSON.stringify(CATALOG)).toBe(before);
    });

    it('fails on a stored row whose data is not JSON', async () => {
      conn
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('custom-bad', 'telescope', '{oops');
      await expect(svc.listCatalog('telescope')).rejects.toThrow(SyntaxError);
    });
  });

  describe('addCustom', () => {
    it.each(['telescope', 'camera', 'accessory', 'filter'] as CustomGearType[])(
      'accepts the type %s, writes the id into the data and returns it',
      async (type) => {
        const { id } = await svc.addCustom(type, { brand: 'B', model: 'M' });
        expect(id).toBe('custom-id1');
        expect(customRows()).toEqual([
          {
            id,
            type,
            data: JSON.stringify({ brand: 'B', model: 'M', id }),
          },
        ]);
      },
    );

    it('overwrites an id given by the caller', async () => {
      const { id } = await svc.addCustom('camera', { id: 'mine', model: 'M' });
      expect(JSON.parse(customRows()[0].data).id).toBe(id);
    });

    it.each([[undefined], [null], [''], ['mount'], [5], [['telescope']]])(
      'rejects the type %j',
      async (type) => {
        const err = await rejection(svc.addCustom(type, { a: 1 }));
        expect(err.kind).toBe('invalid');
        expect(err.message).toBe('Invalid type — must be telescope, camera, accessory, or filter');
        expect(err.body).toBeUndefined();
      },
    );

    it.each([[undefined], [null], [0], ['text'], [[1, 2]]])('rejects the data %j', async (data) => {
      const err = await rejection(svc.addCustom('telescope', data));
      expect(err.kind).toBe('invalid');
      expect(err.message).toBe('Invalid data — must be a non-null object');
    });

    it('checks the type before the data', async () => {
      const err = await rejection(svc.addCustom('nope', null));
      expect(err.message).toContain('Invalid type');
    });

    it('stores nothing when it rejects', async () => {
      await rejection(svc.addCustom('telescope', null));
      expect(customRows()).toEqual([]);
    });
  });

  describe('removeCustom', () => {
    it('removes a custom item', async () => {
      const { id } = await svc.addCustom('camera', { model: 'M' });
      await svc.removeCustom(id);
      expect(customRows()).toEqual([]);
    });

    it('rejects an id without the custom- prefix, even when a row has it', async () => {
      conn
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('imported-1', 'camera', '{}');
      const err = await rejection(svc.removeCustom('imported-1'));
      expect(err.kind).toBe('invalid');
      expect(err.message).toBe('Only custom gear items can be deleted');
      expect(customRows()).toHaveLength(1);
    });

    it('rejects an unknown custom id as not found', async () => {
      const err = await rejection(svc.removeCustom('custom-missing'));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Not found');
    });
  });

  describe('removeAllCustom', () => {
    it('returns 0 when there is nothing', async () => {
      expect(await svc.removeAllCustom()).toBe(0);
    });

    it('removes only the items whose id starts with custom- and returns how many', async () => {
      await svc.addCustom('telescope', { a: 1 });
      await svc.addCustom('filter', { a: 2 });
      await svc.importCustom({ id: 'scope-from-backup', type: 'telescope', data: {} }, []);
      expect(await svc.removeAllCustom()).toBe(2);
      expect(customRows().map((r) => r.id)).toEqual(['scope-from-backup']);
    });
  });

  describe('setups', () => {
    it('lists nothing on an empty database', async () => {
      expect(await svc.listSetups()).toEqual([]);
    });

    it('creates a setup with a setup- id and lists it in the API shape', async () => {
      const { id } = await svc.createSetup({ ...setup, name: '  Main rig  ' });
      expect(id).toBe('setup-id1');
      expect(await svc.listSetups()).toEqual([{ id, ...setup }]);
      expect(Object.keys((await svc.listSetups())[0])).toEqual([
        'id',
        'name',
        'telescopeId',
        'cameraId',
        'accessoryId',
        'enabled',
      ]);
    });

    it('stores a missing accessory as null and enabled as true unless it is false', async () => {
      const { id } = await svc.createSetup({ name: 'N', telescopeId: 't', cameraId: 'c' });
      expect((await svc.listSetups())[0]).toMatchObject({ id, accessoryId: null, enabled: true });
      await svc.createSetup({ name: 'N2', telescopeId: 't', cameraId: 'c', enabled: 0 });
      expect((await svc.listSetups())[1].enabled).toBe(true);
      await svc.createSetup({ name: 'N3', telescopeId: 't', cameraId: 'c', enabled: false });
      expect((await svc.listSetups())[2].enabled).toBe(false);
    });

    it('does not check that the gear ids exist', async () => {
      await svc.createSetup({ name: 'N', telescopeId: 'no-such', cameraId: 'neither' });
      expect(await svc.listSetups()).toHaveLength(1);
    });

    it.each([[undefined], [{}], [{ name: '   ', telescopeId: 't', cameraId: 'c' }], [{ name: 5 }]])(
      'rejects a missing name (%j) with its code and body',
      async (input) => {
        const err = await rejection(svc.createSetup(input));
        expect(err.kind).toBe('invalid');
        expect(err.code).toBe('MISSING_NAME');
        expect(err.body).toEqual({ error: 'name is required', code: 'MISSING_NAME' });
      },
    );

    it.each([[{ name: 'N', cameraId: 'c' }], [{ name: 'N', telescopeId: 5, cameraId: 'c' }]])(
      'rejects a missing telescope (%j) with its code and body',
      async (input) => {
        const err = await rejection(svc.createSetup(input));
        expect(err.code).toBe('MISSING_TELESCOPE');
        expect(err.body).toEqual({ error: 'telescopeId is required', code: 'MISSING_TELESCOPE' });
      },
    );

    it.each([[{ name: 'N', telescopeId: 't' }], [{ name: 'N', telescopeId: 't', cameraId: '' }]])(
      'rejects a missing camera (%j) with its code and body',
      async (input) => {
        const err = await rejection(svc.createSetup(input));
        expect(err.code).toBe('MISSING_CAMERA');
        expect(err.body).toEqual({ error: 'cameraId is required', code: 'MISSING_CAMERA' });
      },
    );

    it('reports the name before the telescope and the telescope before the camera', async () => {
      expect((await rejection(svc.createSetup({}))).code).toBe('MISSING_NAME');
      expect((await rejection(svc.createSetup({ name: 'N' }))).code).toBe('MISSING_TELESCOPE');
    });

    it('replaces a setup in full and moves it to the end of the list', async () => {
      const { id } = await svc.createSetup(setup);
      const second = await svc.createSetup({ ...setup, name: 'Second' });
      await svc.replaceSetup(id, { name: ' Renamed ', telescopeId: 't9', cameraId: 'c9' });
      const list = await svc.listSetups();
      expect(list.map((s) => s.id)).toEqual([second.id, id]); // INSERT OR REPLACE moves the row to the end
      expect(list[1]).toEqual({
        id,
        name: 'Renamed',
        telescopeId: 't9',
        cameraId: 'c9',
        accessoryId: null,
        enabled: true,
      });
    });

    it('creates the setup when the id is unknown', async () => {
      await svc.replaceSetup('setup-new', setup);
      expect(await svc.listSetups()).toEqual([{ id: 'setup-new', ...setup }]);
    });

    it.each([
      [undefined],
      [{ telescopeId: 't', cameraId: 'c' }],
      [{ name: '  ', telescopeId: 't', cameraId: 'c' }],
      [{ name: 'N', cameraId: 'c' }],
      [{ name: 'N', telescopeId: 't' }],
    ])('rejects a replacement with missing fields (%j) with one message', async (input) => {
      const err = await rejection(svc.replaceSetup('setup-1', input));
      expect(err.kind).toBe('invalid');
      expect(err.message).toBe('name, telescopeId, and cameraId are required');
      expect(err.code).toBe('SETUP_FIELDS_REQUIRED');
      expect(err.body).toBeUndefined();
      expect(await svc.listSetups()).toEqual([]);
    });

    it('shows and hides a setup', async () => {
      const { id } = await svc.createSetup(setup);
      await svc.setSetupEnabled(id, false);
      expect((await svc.listSetups())[0].enabled).toBe(false);
      await svc.setSetupEnabled(id, true);
      expect((await svc.listSetups())[0].enabled).toBe(true);
    });

    it.each([['true'], [1], [undefined], [null]])('rejects enabled=%j', async (enabled) => {
      const { id } = await svc.createSetup(setup);
      const err = await rejection(svc.setSetupEnabled(id, enabled));
      expect(err.kind).toBe('invalid');
      expect(err.message).toBe('enabled must be boolean');
    });

    it('rejects enabled for an unknown setup as not found, after checking the value', async () => {
      const err = await rejection(svc.setSetupEnabled('setup-missing', true));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Setup not found');
      expect((await rejection(svc.setSetupEnabled('setup-missing', 'x'))).kind).toBe('invalid');
    });

    it('removes a setup', async () => {
      const { id } = await svc.createSetup(setup);
      await svc.removeSetup(id);
      expect(await svc.listSetups()).toEqual([]);
    });

    it('rejects removing an unknown setup as not found', async () => {
      const err = await rejection(svc.removeSetup('setup-missing'));
      expect(err.kind).toBe('notFound');
      expect(err.message).toBe('Setup not found');
    });

    it('removes every setup and returns how many', async () => {
      expect(await svc.removeAllSetups()).toBe(0);
      await svc.createSetup(setup);
      await svc.createSetup(setup);
      expect(await svc.removeAllSetups()).toBe(2);
      expect(await svc.listSetups()).toEqual([]);
    });

    it('does not touch custom gear when a setup is removed', async () => {
      const gear = await svc.addCustom('telescope', { model: 'M' });
      const { id } = await svc.createSetup({ ...setup, telescopeId: gear.id });
      await svc.removeSetup(id);
      expect(customRows()).toHaveLength(1);
      await svc.createSetup({ ...setup, telescopeId: gear.id });
      await svc.removeCustom(gear.id);
      expect(await svc.listSetups()).toHaveLength(1);
    });
  });

  describe('exportCustom and listCustomNames', () => {
    it('exports nothing on an empty database', async () => {
      expect(await svc.exportCustom()).toEqual([]);
      expect(await svc.listCustomNames()).toEqual([]);
    });

    it('exports each item as id, type, then its fields', async () => {
      const { id } = await svc.addCustom('telescope', { name: 'Vega', brand: 'B' });
      const [item] = await svc.exportCustom();
      expect(item).toEqual({ id, type: 'telescope', name: 'Vega', brand: 'B' });
      expect(Object.keys(item)).toEqual(['id', 'type', 'name', 'brand']);
    });

    it('exports the filters too (the import is what skips them)', async () => {
      await svc.addCustom('filter', { name: 'F' });
      expect((await svc.exportCustom()).map((g) => g.type)).toEqual(['filter']);
    });

    it('names an item by brand and model, else its name field, else its id', async () => {
      const named = await svc.addCustom('camera', { name: 'Cam' });
      const unnamed = await svc.addCustom('camera', { model: 'M' });
      const numeric = await svc.addCustom('camera', { name: 7 });
      const branded = await svc.addCustom('camera', { brand: 'Zed', model: 'Cam 7' });
      expect(await svc.listCustomNames()).toEqual([
        { id: named.id, type: 'camera', name: 'Cam' },
        { id: unnamed.id, type: 'camera', name: 'M' },
        { id: numeric.id, type: 'camera', name: numeric.id },
        { id: branded.id, type: 'camera', name: 'Zed Cam 7' },
      ]);
    });

    it('names an item whose data is not JSON by its id, without failing', async () => {
      conn
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('custom-bad', 'accessory', '{oops');
      expect(await svc.listCustomNames()).toEqual([
        { id: 'custom-bad', type: 'accessory', name: 'custom-bad' },
      ]);
    });
  });

  describe('importCustom', () => {
    it('writes an item with its own id, type and data, and the id inside the data', async () => {
      await svc.importCustom({ id: 'scope-1', type: 'telescope', data: { name: 'Vega' } }, []);
      expect(customRows()).toEqual([
        { id: 'scope-1', type: 'telescope', data: JSON.stringify({ name: 'Vega', id: 'scope-1' }) },
      ]);
    });

    it('replaces the item with the same id', async () => {
      await svc.importCustom({ id: 'scope-1', type: 'telescope', data: { name: 'Old' } }, []);
      await svc.importCustom({ id: 'scope-1', type: 'telescope', data: { name: 'New' } }, []);
      expect(customRows()).toHaveLength(1);
      expect(JSON.parse(customRows()[0].data).name).toBe('New');
    });

    it('deletes the listed items first', async () => {
      await svc.importCustom({ id: 'a', type: 'camera', data: { name: 'X' } }, []);
      await svc.importCustom({ id: 'b', type: 'camera', data: { name: 'X' } }, []);
      await svc.importCustom({ id: 'c', type: 'camera', data: { name: 'X' } }, ['a', 'b', 'nope']);
      expect(customRows().map((r) => r.id)).toEqual(['c']);
    });

    it('does not check the id prefix or the data', async () => {
      await svc.importCustom({ id: 'anything', type: 'filter', data: {} }, []);
      expect(customRows()).toHaveLength(1);
    });

    it('keeps the deleted items when the write fails (one transaction)', async () => {
      await svc.importCustom({ id: 'a', type: 'camera', data: { name: 'X' } }, []);
      await expect(
        svc.importCustom({ id: 'b', type: 'bogus' as CustomGearType, data: {} }, ['a']),
      ).rejects.toThrow();
      expect(customRows().map((r) => r.id)).toEqual(['a']);
    });
  });

  describe('importSetup', () => {
    const imported = {
      id: 'setup-imp',
      name: 'Imported',
      telescopeId: 't2',
      cameraId: 'c2',
      accessoryId: null,
      enabled: false,
    };

    it('writes a setup with its own id', async () => {
      await svc.importSetup(imported, []);
      expect(await svc.listSetups()).toEqual([imported]);
    });

    it('replaces the setup with the same id and moves it to the end', async () => {
      await svc.importSetup(imported, []);
      await svc.importSetup({ ...imported, id: 'other' }, []);
      await svc.importSetup({ ...imported, telescopeId: 't3' }, []);
      const list = await svc.listSetups();
      expect(list.map((s) => s.id)).toEqual(['other', 'setup-imp']);
      expect(list[1].telescopeId).toBe('t3');
    });

    it('deletes the listed setups first', async () => {
      await svc.importSetup({ ...imported, id: 'a' }, []);
      await svc.importSetup({ ...imported, id: 'b' }, []);
      await svc.importSetup({ ...imported, id: 'c' }, ['a', 'b']);
      expect((await svc.listSetups()).map((s) => s.id)).toEqual(['c']);
    });

    it('keeps the deleted setups when the write fails (one transaction)', async () => {
      await svc.importSetup({ ...imported, id: 'a' }, []);
      await expect(
        svc.importSetup({ ...imported, id: 'b', telescopeId: null as unknown as string }, ['a']),
      ).rejects.toThrow();
      expect((await svc.listSetups()).map((s) => s.id)).toEqual(['a']);
    });
  });
});

describe.each(SQL_ADAPTERS)('GearService round trips (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  beforeEach(async () => {
    conn = new Database(':memory:');
    db = countingSqlDb(wrap(createBetterSqliteDb(conn)));
    await initSchema(db);
    db.reset();
  });
  afterEach(() => conn.close());

  /** Round trips made by `fn`. */
  const trips = async (fn: () => Promise<unknown>): Promise<number> => {
    db.reset();
    await fn();
    return db.calls();
  };

  it('makes one round trip per method, whatever the number of rows', async () => {
    let n = 0;
    const svc = createGearService({ db, newId: () => `t${++n}`, catalog: CATALOG });
    const setup = { name: 'S', telescopeId: 't', cameraId: 'c' };
    const { id: customId } = await svc.addCustom('camera', { name: 'Mine' });
    const { id: setupId } = await svc.createSetup(setup);

    expect(await trips(() => svc.listCatalog('camera'))).toBe(1);
    expect(await trips(() => svc.addCustom('camera', { name: 'X' }))).toBe(1);
    expect(await trips(() => svc.removeCustom(customId))).toBe(1);
    expect(await trips(() => svc.removeAllCustom())).toBe(1);
    expect(await trips(() => svc.listSetups())).toBe(1);
    expect(await trips(() => svc.createSetup(setup))).toBe(1);
    expect(await trips(() => svc.replaceSetup(setupId, setup))).toBe(1);
    expect(await trips(() => svc.setSetupEnabled(setupId, false))).toBe(1);
    expect(await trips(() => svc.removeSetup(setupId))).toBe(1);
    expect(await trips(() => svc.removeAllSetups())).toBe(1);
    expect(await trips(() => svc.exportCustom())).toBe(1);
    expect(await trips(() => svc.listCustomNames())).toBe(1);
  });

  it('imports an item or a setup in one batch, whatever the number of replaced ids', async () => {
    const svc = createGearService({ db, newId: () => 'x', catalog: CATALOG });
    const item = { id: 'custom-1', type: 'camera' as const, data: { name: 'N' } };
    const setup = {
      id: 'setup-1',
      name: 'S',
      telescopeId: 't',
      cameraId: 'c',
      accessoryId: null,
      enabled: true,
    };
    expect(await trips(() => svc.importCustom(item, []))).toBe(1);
    expect(await trips(() => svc.importCustom(item, ['custom-a', 'custom-b', 'custom-c']))).toBe(1);
    expect(await trips(() => svc.importSetup(setup, []))).toBe(1);
    expect(await trips(() => svc.importSetup(setup, ['setup-a', 'setup-b', 'setup-c']))).toBe(1);
  });
});

describe('customGearName', () => {
  it('is brand and model, then name, then the id', () => {
    expect(customGearName('telescope', { brand: 'Zed', model: 'T 100', name: 'x' }, 'id')).toBe(
      'Zed T 100',
    );
    expect(customGearName('camera', { model: 'Only model' }, 'id')).toBe('Only model');
    expect(customGearName('camera', { name: 'Named' }, 'id')).toBe('Named');
    expect(customGearName('accessory', {}, 'custom-1')).toBe('custom-1');
  });

  it('names a custom filter by its name, then its model', () => {
    expect(customGearName('filter', { brand: 'B', model: 'M', name: 'N' }, 'id')).toBe('N');
    expect(customGearName('filter', { brand: 'B', model: 'M' }, 'id')).toBe('M');
  });
});
