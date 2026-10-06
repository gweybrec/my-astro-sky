/**
 * Night plans: named target lists with their entries (one frame each) and mosaics (a group of tile entries).
 * A mosaic tile is a `plan_entries` row with `mosaic_id` set and the id `tile-<mosaicId>-<position>`.
 * There are no foreign keys between the plan tables: every cascade is written out here.
 */
import { DomainError } from '../domain/errors';
import {
  PLAN_SORT_KEYS,
  type BackupPlan,
  type MosaicParams,
  type MosaicTileInput,
  type ObservationWindow,
  type Plan,
  type PlanChanges,
  type PlanEntry,
  type PlanEntryChanges,
  type PlanEntryInput,
  type PlanImportOptions,
  type PlanInput,
  type PlanMosaic,
  type PlanSortKey,
} from '../domain/plans';
import type { SqlDb, SqlStatement, SqlValue } from '../ports/sql-db';

export interface PlanServiceDeps {
  db: SqlDb;
  /** Makes a unique id; the service prefixes it with `plan-`, `pe-` or `mo-`. */
  newId: () => string;
}

export interface PlanService {
  /** Every plan with its entries and mosaics, in position order. Also the shape a backup stores. */
  list(): Promise<Plan[]>;
  /** The id and name of every plan, in position order (for the name checks of a backup import). */
  listNames(): Promise<{ id: string; name: string }[]>;
  /** Creates a plan at the end of the list. Throws `invalid` (`PLAN_NAME_REQUIRED`). */
  create(input: PlanInput): Promise<{ id: string }>;
  /** Gives every listed plan the position of its index; unknown ids are ignored. Throws `invalid` (`PLAN_IDS_NOT_ARRAY`). */
  reorder(ids: readonly string[]): Promise<void>;
  /**
   * Renames a plan and/or changes its settings and sort key. Every check runs before anything is written, and
   * the writes are one atomic batch. Throws `invalid`, `notFound` (`PLAN_NOT_FOUND`).
   */
  update(id: string, changes: PlanChanges): Promise<void>;
  /** Deletes a plan with its entries and mosaics. Throws `notFound` (`PLAN_NOT_FOUND`). */
  remove(id: string): Promise<void>;
  /** Adds a target or a custom location. Throws `notFound`, `invalid`, or `conflict` (`DUPLICATE_ENTRY`). */
  addEntry(planId: string, input: PlanEntryInput): Promise<{ id: string }>;
  /** Gives every listed entry of the plan the position of its index. Throws `invalid` (`PLAN_IDS_NOT_ARRAY`). */
  reorderEntries(planId: string, ids: readonly string[]): Promise<void>;
  /** Removes an entry. Throws `notFound` (`ENTRY_NOT_FOUND`). */
  removeEntry(entryId: string): Promise<void>;
  /** Changes the framing fields present in `changes`. Throws `invalid`, `notFound` (`ENTRY_NOT_FOUND`). */
  updateEntry(entryId: string, changes: PlanEntryChanges): Promise<void>;
  /** Creates a mosaic and its tile entries in one transaction. Throws `notFound` (`PLAN_NOT_FOUND`), `invalid`. */
  createMosaic(planId: string, params: MosaicParams): Promise<{ id: string }>;
  /** Replaces a mosaic's parameters and its tiles in one transaction. Throws `notFound` (`MOSAIC_NOT_FOUND`), `invalid`. */
  updateMosaic(planId: string, mosaicId: string, params: MosaicParams): Promise<void>;
  /** Deletes a mosaic and its tiles. Throws `notFound` (`MOSAIC_NOT_FOUND`). */
  removeMosaic(planId: string, mosaicId: string): Promise<void>;
  /**
   * Writes one plan of a backup file in one atomic batch: the plans in `options.replaceIds` and the plan with
   * the same id are deleted (with their entries and mosaics), then the plan, its valid entries and its valid
   * mosaics are inserted. Returns false, writing nothing, when the plan has no string id or name.
   */
  importPlan(plan: BackupPlan, options: PlanImportOptions): Promise<boolean>;
}

interface PlanRow {
  id: string;
  name: string;
  position: number;
  night_of: string | null;
  setup_id: string | null;
  lat: number | null;
  lon: number | null;
  sort_by: string | null;
}

interface PlanEntryRow {
  id: string;
  plan_id: string;
  dso_id: string | null;
  position: number;
  pa_deg: number | null;
  ra: number | null;
  dec: number | null;
  notes: string | null;
  mosaic_id: string | null;
  mosaic_w_deg: number | null;
  mosaic_h_deg: number | null;
  observation_windows: string | null;
}

interface PlanMosaicRow {
  id: string;
  plan_id: string;
  dso_id: string | null;
  name: string | null;
  center_ra: number;
  center_dec: number;
  pa_deg: number;
  overlap_pct: number;
  cols: number;
  rows: number;
  position: number;
}

const SELECT_PLANS = 'SELECT * FROM plans ORDER BY position ASC, rowid ASC';
const SELECT_PLAN = 'SELECT * FROM plans WHERE id = ?';
const SELECT_PLAN_NAMES = 'SELECT id, name FROM plans ORDER BY position ASC, rowid ASC';
// The new plan goes at the end: its position is the number of plans, counted by the same statement.
const INSERT_PLAN_AT_END =
  'INSERT INTO plans (id, name, position, created_at, night_of, setup_id, lat, lon, sort_by) VALUES (?, ?, (SELECT COUNT(*) FROM plans), ?, ?, ?, ?, ?, ?)';
const INSERT_PLAN =
  'INSERT INTO plans (id, name, position, created_at, night_of, setup_id, lat, lon, sort_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
const RENAME_PLAN = 'UPDATE plans SET name = ? WHERE id = ?';
const UPDATE_PLAN_SETTINGS =
  'UPDATE plans SET night_of = ?, setup_id = ?, lat = ?, lon = ? WHERE id = ?';
const UPDATE_PLAN_SORT = 'UPDATE plans SET sort_by = ? WHERE id = ?';
const UPDATE_PLAN_POSITION = 'UPDATE plans SET position = ? WHERE id = ?';
const DELETE_PLAN = 'DELETE FROM plans WHERE id = ?';

const SELECT_ENTRIES = 'SELECT * FROM plan_entries ORDER BY position ASC, rowid ASC';
const ENTRY_EXISTS = 'SELECT 1 FROM plan_entries WHERE plan_id = ? AND dso_id = ?';
const NEXT_ENTRY_POSITION =
  'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM plan_entries WHERE plan_id = ?';
const INSERT_ENTRY =
  'INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, ra, dec, notes, mosaic_id, mosaic_w_deg, mosaic_h_deg, observation_windows) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
// The same insert, with the position taken from the end of the plan by the statement itself.
const INSERT_ENTRY_AT_END =
  'INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, ra, dec, notes, mosaic_id, mosaic_w_deg, mosaic_h_deg, observation_windows) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM plan_entries WHERE plan_id = ?), ?, ?, ?, ?, ?, ?, ?, ?)';
const DELETE_ENTRY = 'DELETE FROM plan_entries WHERE id = ?';
const DELETE_PLAN_ENTRIES = 'DELETE FROM plan_entries WHERE plan_id = ?';
const UPDATE_ENTRY_POSITION = 'UPDATE plan_entries SET position = ? WHERE id = ? AND plan_id = ?';
// A mosaic represents its whole target, so it replaces any standalone frame for the same DSO
// (mosaic tiles carry a mosaic_id; standalone entries don't).
const DELETE_STANDALONE_ENTRY_BY_DSO =
  'DELETE FROM plan_entries WHERE plan_id = ? AND dso_id = ? AND mosaic_id IS NULL';
const DELETE_ENTRY_IN_PLAN = 'DELETE FROM plan_entries WHERE id = ? AND plan_id = ?';
const DELETE_MOSAIC_TILES = 'DELETE FROM plan_entries WHERE mosaic_id = ?';

const SELECT_MOSAICS = 'SELECT * FROM plan_mosaics ORDER BY position ASC, rowid ASC';
const SELECT_MOSAIC = 'SELECT * FROM plan_mosaics WHERE id = ?';
const INSERT_MOSAIC =
  'INSERT INTO plan_mosaics (id, plan_id, dso_id, name, center_ra, center_dec, pa_deg, overlap_pct, cols, rows, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const INSERT_MOSAIC_AT_END =
  'INSERT INTO plan_mosaics (id, plan_id, dso_id, name, center_ra, center_dec, pa_deg, overlap_pct, cols, rows, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM plan_mosaics WHERE plan_id = ?))';
const UPDATE_MOSAIC =
  'UPDATE plan_mosaics SET dso_id = ?, center_ra = ?, center_dec = ?, pa_deg = ?, overlap_pct = ?, cols = ?, rows = ? WHERE id = ?';
// A second variant also updates `name`: used only when the caller supplies a name (the modal save), so
// background tile drags and transforms never clobber it.
const UPDATE_MOSAIC_WITH_NAME =
  'UPDATE plan_mosaics SET dso_id = ?, name = ?, center_ra = ?, center_dec = ?, pa_deg = ?, overlap_pct = ?, cols = ?, rows = ? WHERE id = ?';
const DELETE_MOSAIC = 'DELETE FROM plan_mosaics WHERE id = ?';
const DELETE_PLAN_MOSAICS = 'DELETE FROM plan_mosaics WHERE plan_id = ?';

const err = (
  kind: 'invalid' | 'notFound' | 'conflict',
  message: string,
  code: string,
  body?: Record<string, unknown>,
): DomainError => new DomainError(kind, message, { code, body });

const planNotFound = (): DomainError => err('notFound', 'Plan not found', 'PLAN_NOT_FOUND');
const entryNotFound = (): DomainError => err('notFound', 'Entry not found', 'ENTRY_NOT_FOUND');
const mosaicNotFound = (): DomainError => err('notFound', 'Mosaic not found', 'MOSAIC_NOT_FOUND');
const idsNotArray = (): DomainError => err('invalid', 'ids must be an array', 'PLAN_IDS_NOT_ARRAY');
const nameRequired = (): DomainError => err('invalid', 'name is required', 'PLAN_NAME_REQUIRED');

const isBlank = (v: unknown): boolean => !v || typeof v !== 'string' || v.trim().length === 0;

function planEntryToApi(e: PlanEntryRow): PlanEntry {
  let observationWindows: ObservationWindow[] = [];
  try {
    observationWindows = JSON.parse(e.observation_windows ?? '[]');
  } catch {
    observationWindows = [];
  }
  return {
    id: e.id,
    dsoId: e.dso_id ?? null,
    position: e.position,
    paDeg: e.pa_deg ?? null,
    ra: e.ra ?? null,
    dec: e.dec ?? null,
    notes: e.notes ?? null,
    mosaicId: e.mosaic_id ?? null,
    mosaicWDeg: e.mosaic_w_deg ?? null,
    mosaicHDeg: e.mosaic_h_deg ?? null,
    observationWindows,
  };
}

function planMosaicToApi(m: PlanMosaicRow): PlanMosaic {
  return {
    id: m.id,
    dsoId: m.dso_id ?? null,
    name: m.name ?? null,
    centerRa: m.center_ra,
    centerDec: m.center_dec,
    paDeg: m.pa_deg,
    overlapPct: m.overlap_pct,
    cols: m.cols,
    rows: m.rows,
    position: m.position,
  };
}

/** Rows grouped by their `plan_id`, each group in the order of the rows. */
function groupByPlan<T extends { plan_id: string }>(rows: T[]): Map<string, T[]> {
  const byPlan = new Map<string, T[]>();
  for (const r of rows) {
    const list = byPlan.get(r.plan_id) ?? [];
    list.push(r);
    byPlan.set(r.plan_id, list);
  }
  return byPlan;
}

/**
 * Validate/coerce a raw value into a well-formed observation-window array, then serialise it to a JSON
 * string for storage. Mirrors the client-side `sanitizeObservationWindows` in `src/observation-windows.ts`;
 * kept independent so untrusted PATCH/import payloads are re-checked on the server side too.
 */
export function sanitizeObservationWindows(raw: unknown): string {
  if (!Array.isArray(raw)) return '[]';
  const MIN = 0.02;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawStart = Number(item.startFrac);
    const rawEnd = Number(item.endFrac);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    let start = clamp01(rawStart);
    let end = clamp01(rawEnd);
    if (end < start) [start, end] = [end, start];
    if (end - start < MIN) {
      end = Math.min(1, start + MIN);
      if (end - start < MIN) start = Math.max(0, end - MIN);
    }
    const filter =
      typeof item.filter === 'string' && item.filter.trim()
        ? item.filter.trim().slice(0, 40)
        : null;
    const color =
      typeof item.color === 'string' && item.color.trim() ? item.color.trim().slice(0, 64) : null;
    const frameSeconds =
      Number.isFinite(Number(item.frameSeconds)) && Number(item.frameSeconds) > 0
        ? Number(item.frameSeconds)
        : null;
    const snap = typeof item.snap === 'boolean' ? item.snap : false;
    const id =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim().slice(0, 64)
        : `ow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    out.push({ id, startFrac: start, endFrac: end, filter, color, frameSeconds, snap });
  }
  return JSON.stringify(out);
}

/** The mosaic fields of a request after validation and coercion (shared by create and update). */
interface ParsedMosaic {
  dsoId: string | null;
  name: string | undefined;
  centerRa: number;
  centerDec: number;
  paDeg: number;
  overlapPct: number;
  cols: number;
  rows: number;
  tiles: MosaicTileInput[];
  replaceEntryIds: string[];
}

/** Validate and coerce a mosaic request body (shared by create and update). */
function parseMosaicParams(params: MosaicParams): ParsedMosaic {
  const {
    dsoId,
    name,
    centerRa,
    centerDec,
    paDeg,
    overlapPct,
    cols,
    rows,
    tiles,
    replaceEntryIds,
  } = params as unknown as Record<string, any>;
  if (typeof centerRa !== 'number' || typeof centerDec !== 'number') {
    throw err('invalid', 'centerRa/centerDec must be numbers', 'MOSAIC_CENTER_INVALID');
  }
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw err('invalid', 'tiles must be a non-empty array', 'MOSAIC_TILES_INVALID');
  }
  const cleanTiles: MosaicTileInput[] = [];
  for (const t of tiles) {
    if (typeof t?.ra !== 'number' || typeof t?.dec !== 'number') {
      throw err('invalid', 'each tile needs numeric ra/dec', 'MOSAIC_TILE_COORDS_INVALID');
    }
    cleanTiles.push({ ra: t.ra, dec: t.dec, paDeg: typeof t.paDeg === 'number' ? t.paDeg : null });
  }
  return {
    dsoId: typeof dsoId === 'string' ? dsoId : null,
    // undefined → "don't touch the stored name" (background drags/transforms).
    name: typeof name === 'string' ? name : undefined,
    centerRa,
    centerDec,
    paDeg: typeof paDeg === 'number' ? paDeg : 0,
    // Clamp to the same sane ranges mosaic.ts enforces at compute time.
    overlapPct: typeof overlapPct === 'number' ? Math.min(90, Math.max(0, overlapPct)) : 20,
    cols: Number.isInteger(cols) ? Math.max(1, cols) : Math.max(1, cleanTiles.length),
    rows: Number.isInteger(rows) ? Math.max(1, rows) : 1,
    tiles: cleanTiles,
    replaceEntryIds: Array.isArray(replaceEntryIds)
      ? replaceEntryIds.filter((x: unknown): x is string => typeof x === 'string')
      : [],
  };
}

/** The statements that insert the tiles of a mosaic, from the first free position of the plan. */
function tileStatements(
  mosaicId: string,
  planId: string,
  dsoId: string | null,
  tiles: readonly MosaicTileInput[],
  firstPosition: number,
): SqlStatement[] {
  let pos = firstPosition;
  return tiles.map((t) => {
    const params: SqlValue[] = [
      `tile-${mosaicId}-${pos}`,
      planId,
      dsoId,
      pos,
      t.paDeg ?? null,
      t.ra,
      t.dec,
      null,
      mosaicId,
      null,
      null,
      '[]',
    ];
    pos++;
    return { sql: INSERT_ENTRY, params };
  });
}

export function createPlanService(deps: PlanServiceDeps): PlanService {
  const { db, newId } = deps;

  return {
    async list() {
      const plans = await db.all<PlanRow>(SELECT_PLANS);
      const entries = groupByPlan(await db.all<PlanEntryRow>(SELECT_ENTRIES));
      const mosaics = groupByPlan(await db.all<PlanMosaicRow>(SELECT_MOSAICS));
      return plans.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nightOf: p.night_of ?? null,
        setupId: p.setup_id ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        sortBy: (p.sort_by ?? 'transit') as PlanSortKey,
        entries: (entries.get(p.id) ?? []).map(planEntryToApi),
        mosaics: (mosaics.get(p.id) ?? []).map(planMosaicToApi),
      }));
    },

    async listNames() {
      return db.all<{ id: string; name: string }>(SELECT_PLAN_NAMES);
    },

    async create(input) {
      const { name } = input;
      if (isBlank(name)) throw nameRequired();
      const id = `plan-${newId()}`;
      await db.run(INSERT_PLAN_AT_END, [
        id,
        name.trim(),
        new Date().toISOString(),
        null,
        null,
        null,
        null,
        'transit',
      ]);
      return { id };
    },

    async reorder(ids) {
      if (!Array.isArray(ids)) throw idsNotArray();
      if (ids.length === 0) return;
      await db.batch(ids.map((id, i) => ({ sql: UPDATE_PLAN_POSITION, params: [i, id] })));
    },

    async update(id, changes) {
      const body = (changes ?? {}) as Record<string, any>;
      const hasName = 'name' in body;
      const hasSettings = 'nightOf' in body || 'setupId' in body || 'lat' in body || 'lon' in body;
      const hasSort = 'sortBy' in body;
      if (!hasName && !hasSettings && !hasSort) {
        throw err(
          'invalid',
          'name, settings (nightOf/setupId/lat/lon), or sortBy required',
          'PLAN_UPDATE_EMPTY',
        );
      }
      const existing = await db.get<PlanRow>(SELECT_PLAN, [id]);
      if (!existing) throw planNotFound();

      // Every check first, in the order of the fields; nothing is written until all have passed.
      const writes: SqlStatement[] = [];
      if (hasName) {
        if (isBlank(body.name)) throw nameRequired();
        writes.push({ sql: RENAME_PLAN, params: [body.name.trim(), id] });
      }
      if (hasSettings) {
        const nightOf = 'nightOf' in body ? body.nightOf || null : (existing.night_of ?? null);
        const setupId = 'setupId' in body ? body.setupId || null : (existing.setup_id ?? null);
        const lat =
          'lat' in body ? (typeof body.lat === 'number' ? body.lat : null) : (existing.lat ?? null);
        const lon =
          'lon' in body ? (typeof body.lon === 'number' ? body.lon : null) : (existing.lon ?? null);
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
          throw err('invalid', 'lat must be between -90 and 90', 'PLAN_LAT_OUT_OF_RANGE');
        }
        if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
          throw err('invalid', 'lon must be between -180 and 180', 'PLAN_LON_OUT_OF_RANGE');
        }
        writes.push({ sql: UPDATE_PLAN_SETTINGS, params: [nightOf, setupId, lat, lon, id] });
      }
      if (hasSort) {
        const sortBy = body.sortBy;
        if (typeof sortBy !== 'string' || !(PLAN_SORT_KEYS as readonly string[]).includes(sortBy)) {
          throw err(
            'invalid',
            `sortBy must be one of: ${PLAN_SORT_KEYS.join(', ')}`,
            'PLAN_SORT_INVALID',
          );
        }
        writes.push({ sql: UPDATE_PLAN_SORT, params: [sortBy, id] });
      }
      await db.batch(writes);
    },

    async remove(id) {
      const deleted = await db.transaction(async (tx) => {
        await tx.run(DELETE_PLAN_ENTRIES, [id]);
        await tx.run(DELETE_PLAN_MOSAICS, [id]);
        return (await tx.run(DELETE_PLAN, [id])).changes > 0;
      });
      if (!deleted) throw planNotFound();
    },

    async addEntry(planId, input) {
      const { dsoId, ra, dec, paDeg } = input;
      return db.transaction(async (tx) => {
        if (!(await tx.get(SELECT_PLAN, [planId]))) throw planNotFound();
        if (dsoId == null) {
          // Custom-location entry (framed on empty sky): no DSO, ra/dec required.
          if (typeof ra !== 'number' || typeof dec !== 'number') {
            throw err('invalid', 'dsoId or ra/dec is required', 'ENTRY_TARGET_REQUIRED');
          }
        } else {
          if (typeof dsoId !== 'string') {
            throw err('invalid', 'dsoId must be a string', 'ENTRY_DSO_NOT_STRING');
          }
          if (await tx.get(ENTRY_EXISTS, [planId, dsoId])) {
            throw err('conflict', 'Target already in plan', 'DUPLICATE_ENTRY', {
              error: 'Target already in plan',
              code: 'DUPLICATE_ENTRY',
            });
          }
        }
        const entryId = `pe-${newId()}`;
        await tx.run(INSERT_ENTRY_AT_END, [
          entryId,
          planId,
          dsoId ?? null,
          planId,
          typeof paDeg === 'number' ? paDeg : null,
          typeof ra === 'number' ? ra : null,
          typeof dec === 'number' ? dec : null,
          null,
          null,
          null,
          null,
          '[]',
        ]);
        return { id: entryId };
      });
    },

    async reorderEntries(planId, ids) {
      if (!Array.isArray(ids)) throw idsNotArray();
      if (ids.length === 0) return;
      await db.batch(ids.map((id, i) => ({ sql: UPDATE_ENTRY_POSITION, params: [i, id, planId] })));
    },

    async removeEntry(entryId) {
      if ((await db.run(DELETE_ENTRY, [entryId])).changes === 0) throw entryNotFound();
    },

    async updateEntry(entryId, changes) {
      const body = changes as Record<string, unknown>;
      const sets: string[] = [];
      const vals: SqlValue[] = [];
      const nullableNumber = (key: 'paDeg' | 'ra' | 'dec' | 'mosaicWDeg' | 'mosaicHDeg') => {
        if (body[key] !== null && typeof body[key] !== 'number') {
          throw err('invalid', `${key} must be a number or null`, 'ENTRY_FIELD_INVALID');
        }
      };

      if ('paDeg' in body) {
        nullableNumber('paDeg');
        sets.push('pa_deg = ?');
        vals.push(body.paDeg as number | null);
      }
      if ('ra' in body) {
        nullableNumber('ra');
        sets.push('ra = ?');
        vals.push(body.ra as number | null);
      }
      if ('dec' in body) {
        nullableNumber('dec');
        sets.push('dec = ?');
        vals.push(body.dec as number | null);
      }
      if ('dsoId' in body) {
        if (body.dsoId !== null && typeof body.dsoId !== 'string') {
          throw err('invalid', 'dsoId must be a string or null', 'ENTRY_FIELD_INVALID');
        }
        sets.push('dso_id = ?');
        vals.push(body.dsoId as string | null);
      }
      if ('mosaicWDeg' in body) {
        nullableNumber('mosaicWDeg');
        sets.push('mosaic_w_deg = ?');
        vals.push(body.mosaicWDeg as number | null);
      }
      if ('mosaicHDeg' in body) {
        nullableNumber('mosaicHDeg');
        sets.push('mosaic_h_deg = ?');
        vals.push(body.mosaicHDeg as number | null);
      }
      if ('observationWindows' in body) {
        if (!Array.isArray(body.observationWindows)) {
          throw err('invalid', 'observationWindows must be an array', 'ENTRY_FIELD_INVALID');
        }
        sets.push('observation_windows = ?');
        vals.push(sanitizeObservationWindows(body.observationWindows));
      }

      if (sets.length === 0) {
        throw err('invalid', 'No updatable fields provided', 'ENTRY_NO_FIELDS');
      }
      vals.push(entryId);
      const { changes: changed } = await db.run(
        `UPDATE plan_entries SET ${sets.join(', ')} WHERE id = ?`,
        vals,
      );
      if (changed === 0) throw entryNotFound();
    },

    async createMosaic(planId, params) {
      return db.transaction(async (tx) => {
        if (!(await tx.get(SELECT_PLAN, [planId]))) throw planNotFound();
        const parsed = parseMosaicParams(params);
        const mosaicId = `mo-${newId()}`;
        // The mosaic stands in for the whole target: drop any single frame for the same DSO, plus the
        // standalone frames the client says it replaces (e.g. a custom-location frame sitting on the
        // target), so none are listed alongside the mosaic.
        const writes: SqlStatement[] = [];
        if (parsed.dsoId) {
          writes.push({ sql: DELETE_STANDALONE_ENTRY_BY_DSO, params: [planId, parsed.dsoId] });
        }
        for (const id of parsed.replaceEntryIds) {
          writes.push({ sql: DELETE_ENTRY_IN_PLAN, params: [id, planId] });
        }
        writes.push({
          sql: INSERT_MOSAIC_AT_END,
          params: [
            mosaicId,
            planId,
            parsed.dsoId,
            parsed.name ?? null,
            parsed.centerRa,
            parsed.centerDec,
            parsed.paDeg,
            parsed.overlapPct,
            parsed.cols,
            parsed.rows,
            planId,
          ],
        });
        await tx.batch(writes);
        const next = await tx.get<{ pos: number }>(NEXT_ENTRY_POSITION, [planId]);
        await tx.batch(tileStatements(mosaicId, planId, parsed.dsoId, parsed.tiles, next!.pos));
        return { id: mosaicId };
      });
    },

    async updateMosaic(planId, mosaicId, params) {
      await db.transaction(async (tx) => {
        const existing = await tx.get<PlanMosaicRow>(SELECT_MOSAIC, [mosaicId]);
        if (!existing || existing.plan_id !== planId) throw mosaicNotFound();
        const parsed = parseMosaicParams(params);
        const writes: SqlStatement[] = [];
        // Absorb standalone frames merged into this mosaic.
        for (const id of parsed.replaceEntryIds) {
          writes.push({ sql: DELETE_ENTRY_IN_PLAN, params: [id, planId] });
        }
        // Only overwrite the name when the caller provided one (the modal save).
        if (parsed.name !== undefined) {
          writes.push({
            sql: UPDATE_MOSAIC_WITH_NAME,
            params: [
              parsed.dsoId,
              parsed.name,
              parsed.centerRa,
              parsed.centerDec,
              parsed.paDeg,
              parsed.overlapPct,
              parsed.cols,
              parsed.rows,
              mosaicId,
            ],
          });
        } else {
          writes.push({
            sql: UPDATE_MOSAIC,
            params: [
              parsed.dsoId,
              parsed.centerRa,
              parsed.centerDec,
              parsed.paDeg,
              parsed.overlapPct,
              parsed.cols,
              parsed.rows,
              mosaicId,
            ],
          });
        }
        writes.push({ sql: DELETE_MOSAIC_TILES, params: [mosaicId] });
        await tx.batch(writes);
        const next = await tx.get<{ pos: number }>(NEXT_ENTRY_POSITION, [existing.plan_id]);
        await tx.batch(
          tileStatements(mosaicId, existing.plan_id, parsed.dsoId, parsed.tiles, next!.pos),
        );
      });
    },

    async removeMosaic(planId, mosaicId) {
      await db.transaction(async (tx) => {
        const existing = await tx.get<PlanMosaicRow>(SELECT_MOSAIC, [mosaicId]);
        if (!existing || existing.plan_id !== planId) throw mosaicNotFound();
        await tx.run(DELETE_MOSAIC_TILES, [mosaicId]);
        if ((await tx.run(DELETE_MOSAIC, [mosaicId])).changes === 0) throw mosaicNotFound();
      });
    },

    async importPlan(plan, options) {
      const p = plan as Record<string, any>;
      if (typeof p?.id !== 'string' || typeof p.name !== 'string') return false;
      const planId: string = p.id;
      const writes: SqlStatement[] = [];
      for (const id of [...options.replaceIds, planId]) {
        writes.push(
          { sql: DELETE_PLAN_ENTRIES, params: [id] },
          { sql: DELETE_PLAN_MOSAICS, params: [id] },
          { sql: DELETE_PLAN, params: [id] },
        );
      }
      writes.push({
        sql: INSERT_PLAN,
        params: [
          planId,
          p.name,
          typeof p.position === 'number' ? p.position : options.index,
          new Date().toISOString(),
          typeof p.nightOf === 'string' ? p.nightOf : null,
          options.setupId,
          typeof p.lat === 'number' ? p.lat : null,
          typeof p.lon === 'number' ? p.lon : null,
          (PLAN_SORT_KEYS as readonly string[]).includes(p.sortBy) ? p.sortBy : 'transit',
        ],
      });
      if (Array.isArray(p.entries)) {
        p.entries.forEach((e: any, ei: number) => {
          if (typeof e.id !== 'string') return;
          const hasDso = typeof e.dsoId === 'string';
          const hasCoords = typeof e.ra === 'number' && typeof e.dec === 'number';
          // An entry needs either a DSO target or explicit frame coords.
          if (!hasDso && !hasCoords) return;
          writes.push({
            sql: INSERT_ENTRY,
            params: [
              e.id,
              planId,
              hasDso ? e.dsoId : null,
              typeof e.position === 'number' ? e.position : ei,
              typeof e.paDeg === 'number' ? e.paDeg : null,
              hasCoords ? e.ra : null,
              hasCoords ? e.dec : null,
              typeof e.notes === 'string' ? e.notes : null,
              // Keep the tile→mosaic grouping (the mosaic row is recreated below).
              typeof e.mosaicId === 'string' ? e.mosaicId : null,
              typeof e.mosaicWDeg === 'number' ? e.mosaicWDeg : null,
              typeof e.mosaicHDeg === 'number' ? e.mosaicHDeg : null,
              sanitizeObservationWindows(e.observationWindows),
            ],
          });
        });
      }
      if (Array.isArray(p.mosaics)) {
        p.mosaics.forEach((m: any, mi: number) => {
          if (typeof m.id !== 'string') return;
          if (typeof m.centerRa !== 'number' || typeof m.centerDec !== 'number') return;
          writes.push({
            sql: INSERT_MOSAIC,
            params: [
              m.id,
              planId,
              typeof m.dsoId === 'string' ? m.dsoId : null,
              typeof m.name === 'string' ? m.name : null,
              m.centerRa,
              m.centerDec,
              typeof m.paDeg === 'number' ? m.paDeg : 0,
              typeof m.overlapPct === 'number' ? m.overlapPct : 20,
              Number.isInteger(m.cols) ? m.cols : 1,
              Number.isInteger(m.rows) ? m.rows : 1,
              typeof m.position === 'number' ? m.position : mi,
            ],
          });
        });
      }
      await db.batch(writes);
      return true;
    },
  };
}
