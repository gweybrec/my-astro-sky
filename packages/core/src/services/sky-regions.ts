/**
 * Sky regions: freehand Alt/Az polygons drawn on the Local Sky (zenith) view, saved by name and
 * used as a Targets search filter.
 */
import { DomainError } from '../domain/errors';
import type { SkyRegionChanges, SkyRegionData, SkyRegionInput } from '../domain/regions';
import type { SqlDb, SqlTx } from '../ports/sql-db';

export interface SkyRegionServiceDeps {
  db: SqlDb;
  /** Makes a unique id; the service prefixes it with `region-`. */
  newId: () => string;
}

/** A region read from a backup file, before it is stored. */
export interface ImportedSkyRegion {
  id: string;
  name: string;
  color: string;
  /** The polygon vertices, stored as given. */
  points: unknown[];
  position: number;
}

export interface SkyRegionService {
  /** Every region ordered by position. A row whose polygon cannot be read comes back with no points. */
  list(): Promise<SkyRegionData[]>;
  /** Creates a region at the end of the list. Throws `invalid` for a missing name or fewer than 3 vertices. */
  create(input: SkyRegionInput): Promise<{ id: string }>;
  /** Changes the fields that are given and valid; others keep their value. Throws `notFound` for an unknown id. */
  update(id: string, input: SkyRegionChanges): Promise<void>;
  /** Removes a region. Throws `notFound` for an unknown id. */
  remove(id: string): Promise<void>;
  /** Writes a region from a backup file, replacing the one with the same id, without the checks of `create`. */
  importOne(region: ImportedSkyRegion): Promise<void>;
}

interface SkyRegionRow {
  id: string;
  name: string;
  color: string;
  /** JSON-encoded {azDeg,altDeg}[] polygon, closed, ≥3 vertices. */
  points: string;
  position: number;
}

const DEFAULT_COLOR = '#4ea1ff';

function isValidRegionPoints(points: unknown): points is { azDeg: number; altDeg: number }[] {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        Number.isFinite((p as Record<string, unknown>).azDeg) &&
        Number.isFinite((p as Record<string, unknown>).altDeg),
    )
  );
}

function rowToApi(r: SkyRegionRow): SkyRegionData {
  let points: SkyRegionData['points'] = [];
  try {
    points = JSON.parse(r.points);
  } catch {
    /* corrupt row, surface as empty polygon rather than failing the whole list */
  }
  return { id: r.id, name: r.name, color: r.color, points, position: r.position };
}

const SELECT_ALL = 'SELECT * FROM sky_regions ORDER BY position ASC, rowid ASC';

async function writeRow(tx: SqlTx, row: SkyRegionRow): Promise<void> {
  await tx.run(
    'INSERT OR REPLACE INTO sky_regions (id, name, color, points, position) VALUES (?, ?, ?, ?, ?)',
    [row.id, row.name.slice(0, 60), row.color.slice(0, 32), row.points, row.position],
  );
}

export function createSkyRegionService(deps: SkyRegionServiceDeps): SkyRegionService {
  const { db, newId } = deps;

  return {
    async list() {
      return (await db.all<SkyRegionRow>(SELECT_ALL)).map(rowToApi);
    },

    async create(input) {
      const { name, color, points } = (input ?? {}) as Record<string, unknown>;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new DomainError('invalid', 'name is required', {
          code: 'MISSING_NAME',
          body: { error: 'name is required', code: 'MISSING_NAME' },
        });
      }
      if (!isValidRegionPoints(points)) {
        throw new DomainError('invalid', 'points must have at least 3 {azDeg,altDeg} vertices', {
          code: 'INVALID_REGION_POINTS',
        });
      }
      const id = `region-${newId()}`;
      // One statement: the new region goes after the existing ones (its position is the row count).
      await db.run(
        `INSERT OR REPLACE INTO sky_regions (id, name, color, points, position)
         SELECT ?, ?, ?, ?, COUNT(*) FROM sky_regions`,
        [
          id,
          name.trim().slice(0, 60),
          (typeof color === 'string' && color.trim() ? color.trim() : DEFAULT_COLOR).slice(0, 32),
          JSON.stringify(points),
        ],
      );
      return { id };
    },

    async update(id, input) {
      const { name, color, points, position } = (input ?? {}) as Record<string, unknown>;
      await db.transaction(async (tx) => {
        const existing = await tx.get<SkyRegionRow>('SELECT * FROM sky_regions WHERE id = ?', [id]);
        if (!existing) {
          throw new DomainError('notFound', 'Region not found', { code: 'REGION_NOT_FOUND' });
        }
        await writeRow(tx, {
          id,
          name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
          color: typeof color === 'string' && color.trim() ? color.trim() : existing.color,
          points: isValidRegionPoints(points) ? JSON.stringify(points) : existing.points,
          position: Number.isFinite(position) ? Number(position) : existing.position,
        });
      });
    },

    async remove(id) {
      const { changes } = await db.run('DELETE FROM sky_regions WHERE id = ?', [id]);
      if (changes === 0) {
        throw new DomainError('notFound', 'Region not found', { code: 'REGION_NOT_FOUND' });
      }
    },

    async importOne(region) {
      await writeRow(db, {
        id: region.id,
        name: region.name,
        color: region.color,
        points: JSON.stringify(region.points),
        position: region.position,
      });
    },
  };
}
