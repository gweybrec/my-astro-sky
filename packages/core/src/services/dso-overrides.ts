/**
 * DSO overrides: the user's own corrections to catalog objects (name, type, coordinates),
 * stored as one JSON document per catalog id.
 */
import { DomainError } from '../domain/errors';
import type { SqlDb } from '../ports/sql-db';

export interface DsoOverrideServiceDeps {
  db: SqlDb;
}

export interface DsoOverrideService {
  /** Every stored override by DSO id. A row whose JSON cannot be read is left out. */
  getAll(): Promise<Record<string, object>>;
  /** Creates or replaces an override. Throws `invalid` for a bad id, bad data or out-of-range RA/Dec. */
  upsert(id: unknown, data: unknown): Promise<void>;
  /** Removes one override; a missing id is not an error. */
  remove(id: string): Promise<void>;
  /** Removes every override and returns how many rows were deleted. */
  removeAll(): Promise<number>;
  /** Writes an override without the checks of `upsert` (backup import has already filtered its entries). */
  importOne(id: string, data: object): Promise<void>;
}

/**
 * Validate RA and Dec fields in a DSO override payload.
 * Returns `{ error, code }` if any value is out of range, otherwise null.
 *
 * Ranges: RA ∈ [0, 360), Dec ∈ [−90, 90].
 */
export function validateDsoOverrideCoords(
  data: Record<string, unknown>,
): { error: string; code: string } | null {
  if (typeof data.ra === 'number' && (data.ra < 0 || data.ra >= 360)) {
    return { error: 'RA must be in [0, 360)', code: 'INVALID_DSO_RA' };
  }
  if (typeof data.dec === 'number' && (data.dec < -90 || data.dec > 90)) {
    return { error: 'Dec must be in [-90, 90]', code: 'INVALID_DSO_DEC' };
  }
  return null;
}

export function createDsoOverrideService(deps: DsoOverrideServiceDeps): DsoOverrideService {
  const { db } = deps;

  const write = async (id: string, data: object): Promise<void> => {
    await db.run('INSERT OR REPLACE INTO dso_overrides (id, data) VALUES (?, ?)', [
      id,
      JSON.stringify(data),
    ]);
  };

  return {
    async getAll() {
      const rows = await db.all<{ id: string; data: string }>('SELECT id, data FROM dso_overrides');
      const result: Record<string, object> = {};
      for (const row of rows) {
        try {
          result[row.id] = JSON.parse(row.data);
        } catch {
          /* skip invalid */
        }
      }
      return result;
    },

    async upsert(id, data) {
      if (typeof id !== 'string' || !id || id.length > 100) {
        throw new DomainError('invalid', 'Invalid DSO id');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new DomainError('invalid', 'Invalid override data');
      }
      const coordError = validateDsoOverrideCoords(data as Record<string, unknown>);
      if (coordError) {
        throw new DomainError('invalid', coordError.error, {
          code: coordError.code,
          body: coordError,
        });
      }
      await write(id, data);
    },

    async remove(id) {
      await db.run('DELETE FROM dso_overrides WHERE id = ?', [id]);
    },

    async removeAll() {
      return (await db.run('DELETE FROM dso_overrides')).changes;
    },

    importOne: write,
  };
}
