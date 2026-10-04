/**
 * Points-of-interest categories (Comet, Asteroid, ...): a user-managed list stored globally, not
 * per photo. A fresh database gets five default rows from `ensureDefaults`.
 */
import { DomainError } from '../domain/errors';
import type { SqlDb, SqlTx } from '../ports/sql-db';
import type { PoiCategory } from '../types';

export interface PoiCategoryServiceDeps {
  db: SqlDb;
  /** Makes a unique id; the service prefixes it with `cat-`. */
  newId: () => string;
}

export interface PoiCategoryService {
  /** Every category ordered by position. */
  list(): Promise<PoiCategory[]>;
  /** Creates a category at the end of the list. Throws `invalid` for a missing name. */
  create(input: unknown): Promise<{ id: string }>;
  /** Changes the fields that are given and valid; others keep their value. Throws `notFound` for an unknown id. */
  update(id: string, input: unknown): Promise<void>;
  /** Removes a category. Throws `notFound` for an unknown id. */
  remove(id: string): Promise<void>;
  /** Removes every category and returns how many there were. */
  removeAll(): Promise<number>;
  /** Writes a category from a backup file, replacing the one with the same id, without the checks of `create`. */
  importOne(category: PoiCategory): Promise<void>;
  /** Inserts the five default categories when the table is empty. Call it once at start-up. */
  ensureDefaults(): Promise<void>;
}

interface PoiCategoryRow {
  id: string;
  name: string;
  color: string;
  position: number;
}

const DEFAULT_COLOR = '#888888';

// A few sensible starting categories. They are fully editable and deletable afterwards.
const DEFAULT_CATEGORIES: readonly PoiCategory[] = [
  { id: 'cat-comet', name: 'Comet', color: '#4ea1ff', position: 0 },
  { id: 'cat-asteroid', name: 'Asteroid', color: '#c9a227', position: 1 },
  { id: 'cat-satellite', name: 'Satellite', color: '#7bd88f', position: 2 },
  { id: 'cat-iss', name: 'ISS', color: '#cbd5e1', position: 3 },
  { id: 'cat-supernova', name: 'Supernova', color: '#ff5a5a', position: 4 },
];

function rowToApi(r: PoiCategoryRow): PoiCategory {
  return { id: r.id, name: r.name, color: r.color, position: r.position };
}

const SELECT_ALL = 'SELECT * FROM poi_categories ORDER BY position ASC, rowid ASC';

async function writeRow(tx: SqlTx, row: PoiCategoryRow): Promise<void> {
  await tx.run(
    'INSERT OR REPLACE INTO poi_categories (id, name, color, position) VALUES (?, ?, ?, ?)',
    [row.id, row.name.slice(0, 60), row.color.slice(0, 32), row.position],
  );
}

export function createPoiCategoryService(deps: PoiCategoryServiceDeps): PoiCategoryService {
  const { db, newId } = deps;

  return {
    async list() {
      return (await db.all<PoiCategoryRow>(SELECT_ALL)).map(rowToApi);
    },

    async create(input) {
      const { name, color } = (input ?? {}) as Record<string, unknown>;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new DomainError('invalid', 'name is required', {
          code: 'MISSING_NAME',
          body: { error: 'name is required', code: 'MISSING_NAME' },
        });
      }
      const id = `cat-${newId()}`;
      await db.transaction(async (tx) => {
        const rows = await tx.all<PoiCategoryRow>(SELECT_ALL);
        await writeRow(tx, {
          id,
          name: name.trim(),
          color: typeof color === 'string' && color.trim() ? color.trim() : DEFAULT_COLOR,
          position: rows.length,
        });
      });
      return { id };
    },

    async update(id, input) {
      const { name, color, position } = (input ?? {}) as Record<string, unknown>;
      await db.transaction(async (tx) => {
        const existing = (await tx.all<PoiCategoryRow>(SELECT_ALL)).find((c) => c.id === id);
        if (!existing) throw new DomainError('notFound', 'Category not found');
        await writeRow(tx, {
          id,
          name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
          color: typeof color === 'string' && color.trim() ? color.trim() : existing.color,
          position: Number.isFinite(position) ? Number(position) : existing.position,
        });
      });
    },

    async remove(id) {
      const { changes } = await db.run('DELETE FROM poi_categories WHERE id = ?', [id]);
      if (changes === 0) throw new DomainError('notFound', 'Category not found');
    },

    async removeAll() {
      return (await db.run('DELETE FROM poi_categories')).changes;
    },

    async importOne(category) {
      await writeRow(db, category);
    },

    async ensureDefaults() {
      await db.transaction(async (tx) => {
        const row = await tx.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM poi_categories');
        if ((row?.cnt ?? 0) !== 0) return;
        for (const c of DEFAULT_CATEGORIES) await writeRow(tx, c);
      });
    },
  };
}
