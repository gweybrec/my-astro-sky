/**
 * Equipment: the built-in catalogues merged with the user's custom gear, and the named gear setups
 * (telescope + camera + optional accessory). Nothing checks that a setup's gear ids exist, and nothing is
 * cascaded to plans or photos when a setup or a gear item is deleted.
 */
import { DomainError } from '../domain/errors';
import { customGearName } from '../domain/gear';
import type {
  CustomGearInput,
  CustomGearType,
  GearCatalog,
  GearSetupData,
  GearSetupInput,
} from '../domain/gear';
import type { SqlDb, SqlValue } from '../ports/sql-db';

export interface GearServiceDeps {
  db: SqlDb;
  /** Makes a unique id; the service prefixes it with `custom-` or `setup-`. */
  newId: () => string;
  /** The built-in lists. The service never reads a file. */
  catalog: GearCatalog;
}

/** A custom gear item as written to a backup: its id and type, then the user's fields. */
export type ExportedCustomGear = { id: string; type: CustomGearType } & Record<string, unknown>;

export interface GearService {
  /** The built-in items of a type plus the custom ones, sorted by "brand model". */
  listCatalog(type: CustomGearType): Promise<object[]>;
  /** Stores a custom item with a new `custom-` id (the id is also written into its data). Throws `invalid` for a bad type or data. */
  addCustom(type: CustomGearType, data: CustomGearInput): Promise<{ id: string }>;
  /** Removes a custom item. Throws `invalid` for an id without the `custom-` prefix, `notFound` for an unknown id. */
  removeCustom(id: string): Promise<void>;
  /** Removes every custom item whose id starts with `custom-` and returns how many. */
  removeAllCustom(): Promise<number>;
  /** Every setup, oldest write first. */
  listSetups(): Promise<GearSetupData[]>;
  /** Creates a setup with a new `setup-` id. Throws `invalid` (codes `MISSING_NAME`, `MISSING_TELESCOPE`, `MISSING_CAMERA`). */
  createSetup(input: GearSetupInput): Promise<{ id: string }>;
  /** Replaces a setup, creating it when the id is unknown (the row moves to the end of the list). Throws `invalid`. */
  replaceSetup(id: string, input: GearSetupInput): Promise<void>;
  /** Shows or hides a setup's frame. Throws `invalid` for a non-boolean, `notFound` for an unknown id. */
  setSetupEnabled(id: string, enabled: boolean): Promise<void>;
  /** Removes a setup. Throws `notFound` for an unknown id. */
  removeSetup(id: string): Promise<void>;
  /** Removes every setup and returns how many. */
  removeAllSetups(): Promise<number>;
  /** Every custom item in the form a backup file stores it. */
  exportCustom(): Promise<ExportedCustomGear[]>;
  /** Every custom item with its display name (its `name` field when it is a string, else its id). */
  listCustomNames(): Promise<{ id: string; type: CustomGearType; name: string }[]>;
  /**
   * Writes a custom item from a backup file without the checks of `addCustom`, replacing the one with the
   * same id. The items in `replaceIds` are deleted first, in the same transaction.
   */
  importCustom(
    item: { id: string; type: CustomGearType; data: object },
    replaceIds: readonly string[],
  ): Promise<void>;
  /** Writes a setup from a backup file, replacing the one with the same id. The setups in `replaceIds` are deleted first, in the same transaction. */
  importSetup(setup: GearSetupData, replaceIds: readonly string[]): Promise<void>;
}

interface CustomGearRow {
  id: string;
  type: CustomGearType;
  data: string;
}

interface GearSetupRow {
  id: string;
  name: string;
  telescope_id: string;
  camera_id: string;
  accessory_id: string | null;
  enabled: number; // 0 | 1
}

const CUSTOM_GEAR_TYPES: readonly string[] = ['telescope', 'camera', 'accessory', 'filter'];
const CATALOG_KEY: Record<CustomGearType, keyof GearCatalog> = {
  telescope: 'telescopes',
  camera: 'cameras',
  accessory: 'accessories',
  filter: 'filters',
};

const SELECT_CUSTOM = 'SELECT id, type, data FROM custom_gear';
const UPSERT_CUSTOM = 'INSERT OR REPLACE INTO custom_gear (id, type, data) VALUES (?, ?, ?)';
const DELETE_CUSTOM = 'DELETE FROM custom_gear WHERE id = ?';
const DELETE_ALL_CUSTOM = "DELETE FROM custom_gear WHERE id LIKE 'custom-%'";
const SELECT_SETUPS = 'SELECT * FROM gear_setups ORDER BY rowid ASC';
const UPSERT_SETUP = `INSERT OR REPLACE INTO gear_setups (id, name, telescope_id, camera_id, accessory_id, enabled)
   VALUES (?, ?, ?, ?, ?, ?)`;
const UPDATE_SETUP_ENABLED = 'UPDATE gear_setups SET enabled = ? WHERE id = ?';
const DELETE_SETUP = 'DELETE FROM gear_setups WHERE id = ?';
const DELETE_ALL_SETUPS = 'DELETE FROM gear_setups';

const byBrandModel = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
  `${a.brand ?? ''} ${a.model ?? ''}`.localeCompare(`${b.brand ?? ''} ${b.model ?? ''}`);

function setupToApi(r: GearSetupRow): GearSetupData {
  return {
    id: r.id,
    name: r.name,
    telescopeId: r.telescope_id,
    cameraId: r.camera_id,
    accessoryId: r.accessory_id ?? null,
    enabled: r.enabled === 1,
  };
}

function setupParams(
  id: string,
  name: string,
  telescopeId: unknown,
  cameraId: unknown,
  accessoryId: unknown,
  enabled: boolean,
): SqlValue[] {
  return [
    id,
    name,
    telescopeId as SqlValue,
    cameraId as SqlValue,
    (accessoryId ?? null) as SqlValue,
    enabled ? 1 : 0,
  ];
}

export function createGearService(deps: GearServiceDeps): GearService {
  const { db, newId, catalog } = deps;

  const allCustom = (): Promise<CustomGearRow[]> => db.all<CustomGearRow>(SELECT_CUSTOM);

  return {
    async listCatalog(type) {
      const custom = (await allCustom())
        .filter((g) => g.type === type)
        .map((g) => JSON.parse(g.data) as Record<string, unknown>);
      return [...(catalog[CATALOG_KEY[type]] as Record<string, unknown>[]), ...custom].sort(
        byBrandModel,
      );
    },

    async addCustom(type, data) {
      // Typed for callers, still checked at run time: a screen or a restored backup can pass anything.
      if (!type || !CUSTOM_GEAR_TYPES.includes(type as string)) {
        throw new DomainError(
          'invalid',
          'Invalid type — must be telescope, camera, accessory, or filter',
          { code: 'INVALID_GEAR_TYPE' },
        );
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new DomainError('invalid', 'Invalid data — must be a non-null object', {
          code: 'INVALID_GEAR_DATA',
        });
      }
      const id = `custom-${newId()}`;
      await db.run(UPSERT_CUSTOM, [id, type as string, JSON.stringify({ ...data, id })]);
      return { id };
    },

    async removeCustom(id) {
      if (!id.startsWith('custom-')) {
        throw new DomainError('invalid', 'Only custom gear items can be deleted', {
          code: 'GEAR_NOT_CUSTOM',
        });
      }
      const { changes } = await db.run(DELETE_CUSTOM, [id]);
      if (changes === 0) throw new DomainError('notFound', 'Not found', { code: 'GEAR_NOT_FOUND' });
    },

    async removeAllCustom() {
      return (await db.run(DELETE_ALL_CUSTOM)).changes;
    },

    async listSetups() {
      return (await db.all<GearSetupRow>(SELECT_SETUPS)).map(setupToApi);
    },

    async createSetup(input) {
      const { name, telescopeId, cameraId, accessoryId, enabled } = (input ?? {}) as Record<
        string,
        unknown
      >;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new DomainError('invalid', 'name is required', {
          code: 'MISSING_NAME',
          body: { error: 'name is required', code: 'MISSING_NAME' },
        });
      }
      if (!telescopeId || typeof telescopeId !== 'string') {
        throw new DomainError('invalid', 'telescopeId is required', {
          code: 'MISSING_TELESCOPE',
          body: { error: 'telescopeId is required', code: 'MISSING_TELESCOPE' },
        });
      }
      if (!cameraId || typeof cameraId !== 'string') {
        throw new DomainError('invalid', 'cameraId is required', {
          code: 'MISSING_CAMERA',
          body: { error: 'cameraId is required', code: 'MISSING_CAMERA' },
        });
      }
      const id = `setup-${newId()}`;
      await db.run(
        UPSERT_SETUP,
        setupParams(id, name.trim(), telescopeId, cameraId, accessoryId, enabled !== false),
      );
      return { id };
    },

    async replaceSetup(id, input) {
      const { name, telescopeId, cameraId, accessoryId, enabled } = (input ?? {}) as Record<
        string,
        unknown
      >;
      if (
        !name ||
        typeof name !== 'string' ||
        name.trim().length === 0 ||
        !telescopeId ||
        !cameraId
      ) {
        throw new DomainError('invalid', 'name, telescopeId, and cameraId are required', {
          code: 'SETUP_FIELDS_REQUIRED',
        });
      }
      await db.run(
        UPSERT_SETUP,
        setupParams(id, name.trim(), telescopeId, cameraId, accessoryId, enabled !== false),
      );
    },

    async setSetupEnabled(id, enabled) {
      if (typeof enabled !== 'boolean') {
        throw new DomainError('invalid', 'enabled must be boolean', {
          code: 'SETUP_ENABLED_NOT_BOOLEAN',
        });
      }
      const { changes } = await db.run(UPDATE_SETUP_ENABLED, [enabled ? 1 : 0, id]);
      if (changes === 0) {
        throw new DomainError('notFound', 'Setup not found', { code: 'SETUP_NOT_FOUND' });
      }
    },

    async removeSetup(id) {
      const { changes } = await db.run(DELETE_SETUP, [id]);
      if (changes === 0) {
        throw new DomainError('notFound', 'Setup not found', { code: 'SETUP_NOT_FOUND' });
      }
    },

    async removeAllSetups() {
      return (await db.run(DELETE_ALL_SETUPS)).changes;
    },

    async exportCustom() {
      return (await allCustom()).map((g) => ({
        id: g.id,
        type: g.type,
        ...(JSON.parse(g.data) as Record<string, unknown>),
      }));
    },

    async listCustomNames() {
      return (await allCustom()).map((g) => {
        let name = g.id;
        try {
          const d = JSON.parse(g.data);
          if (d && typeof d === 'object') name = customGearName(g.type, d, g.id);
        } catch {
          /* keep the id */
        }
        return { id: g.id, type: g.type, name };
      });
    },

    async importCustom(item, replaceIds) {
      // One atomic batch: the replaced items are deleted, then the item is written.
      await db.batch([
        ...replaceIds.map((id) => ({ sql: DELETE_CUSTOM, params: [id] })),
        {
          sql: UPSERT_CUSTOM,
          params: [item.id, item.type, JSON.stringify({ ...item.data, id: item.id })],
        },
      ]);
    },

    async importSetup(setup, replaceIds) {
      // One atomic batch: the replaced setups are deleted, then the setup is written.
      await db.batch([
        ...replaceIds.map((id) => ({ sql: DELETE_SETUP, params: [id] })),
        {
          sql: UPSERT_SETUP,
          params: setupParams(
            setup.id,
            setup.name,
            setup.telescopeId,
            setup.cameraId,
            setup.accessoryId,
            setup.enabled,
          ),
        },
      ]);
    },
  };
}
