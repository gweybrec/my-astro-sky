import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../server/db-migrations';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an in-memory DB with the base tables that existed before migrations. */
function freshBaseDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS star_correspondences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      point_index INTEGER NOT NULL,
      photo_x REAL NOT NULL,
      photo_y REAL NOT NULL,
      star_hip INTEGER NOT NULL,
      star_name TEXT,
      UNIQUE(photo_id, point_index)
    );
  `);
  return db;
}

function getColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map(r => r.name);
}

function schemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    return row?.version ?? 0;
  } catch {
    return -1;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('applyMigrations — fresh database', () => {
  it('creates the schema_version table', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(() => db.prepare('SELECT version FROM schema_version').get()).not.toThrow();
  });

  it('returns the latest schema version after first run', () => {
    const db = freshBaseDb();
    const version = applyMigrations(db);
    expect(version).toBe(3);
  });

  it('schema_version table contains the latest version', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(schemaVersion(db)).toBe(3);
  });

  it('adds star_ra and star_dec columns to star_correspondences', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    const cols = getColumns(db, 'star_correspondences');
    expect(cols).toContain('star_ra');
    expect(cols).toContain('star_dec');
  });

  it('adds all expected columns to photos', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    const cols = getColumns(db, 'photos');
    expect(cols).toContain('manual_placement');
    expect(cols).toContain('dso_ids');
    expect(cols).toContain('labels');
    expect(cols).toContain('notes');
    expect(cols).toContain('integrations');
    expect(cols).toContain('display_order');
    expect(cols).toContain('thumb_filename');
    expect(cols).toContain('observation_date');
  });
});

describe('applyMigrations — idempotency', () => {
  it('is safe to call twice (idempotent)', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
  });

  it('does not change the version when called again', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    const v = applyMigrations(db);
    expect(v).toBe(3);
    expect(schemaVersion(db)).toBe(3);
  });
});

describe('applyMigrations — v2 per-plan night/setup', () => {
  it('adds night_of and setup_id columns to an existing plans table', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    applyMigrations(db);
    const cols = getColumns(db, 'plans');
    expect(cols).toContain('night_of');
    expect(cols).toContain('setup_id');
  });

  it('is a no-op (no throw) when the plans table is absent', () => {
    const db = freshBaseDb();
    expect(() => applyMigrations(db)).not.toThrow();
    expect(schemaVersion(db)).toBe(3);
  });
});

describe('applyMigrations — v3 plan_entries frame position', () => {
  /** Recreate the pre-v3 plan_entries shape (NOT NULL dso_id, UNIQUE, no ra/dec). */
  function withOldPlanEntries(db: Database.Database) {
    db.exec(`
      CREATE TABLE plan_entries (
        id       TEXT PRIMARY KEY,
        plan_id  TEXT NOT NULL,
        dso_id   TEXT NOT NULL,
        position INTEGER NOT NULL,
        pa_deg   REAL,
        notes    TEXT,
        UNIQUE(plan_id, dso_id)
      );
    `);
  }

  it('rebuilds plan_entries: dso_id becomes nullable, ra/dec added, rows preserved', () => {
    const db = freshBaseDb();
    withOldPlanEntries(db);
    db.prepare('INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run('e1', 'p1', 'M42', 0, 142, 'note');

    applyMigrations(db);

    const cols = getColumns(db, 'plan_entries');
    expect(cols).toContain('ra');
    expect(cols).toContain('dec');
    // dso_id is now nullable (was NOT NULL) — a null insert must succeed.
    expect(() =>
      db.prepare('INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, ra, dec, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('e2', 'p1', null, 1, null, 12.3, 45.6, null),
    ).not.toThrow();

    const row = db.prepare('SELECT * FROM plan_entries WHERE id = ?').get('e1') as any;
    expect(row.dso_id).toBe('M42');
    expect(row.pa_deg).toBe(142);
    expect(schemaVersion(db)).toBe(3);
  });

  it('is idempotent on an already-migrated plan_entries table', () => {
    const db = freshBaseDb();
    withOldPlanEntries(db);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const cols = getColumns(db, 'plan_entries');
    expect(cols.filter(c => c === 'ra').length).toBe(1);
  });
});

describe('applyMigrations — existing database (simulates upgrade)', () => {
  it('runs migration on a database that already has all columns (no-op, no throw)', () => {
    const db = freshBaseDb();
    // Pre-add all columns as if migration 1 had already been applied manually
    db.exec('ALTER TABLE star_correspondences ADD COLUMN star_ra REAL');
    db.exec('ALTER TABLE star_correspondences ADD COLUMN star_dec REAL');
    db.exec('ALTER TABLE photos ADD COLUMN manual_placement TEXT');
    db.exec("ALTER TABLE photos ADD COLUMN dso_ids TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE photos ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'");
    db.exec("ALTER TABLE photos ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE photos ADD COLUMN integrations TEXT NOT NULL DEFAULT '[]'");
    db.exec('ALTER TABLE photos ADD COLUMN display_order INTEGER');
    db.exec('ALTER TABLE photos ADD COLUMN thumb_filename TEXT');
    db.exec('ALTER TABLE photos ADD COLUMN observation_date TEXT');

    expect(() => applyMigrations(db)).not.toThrow();
    expect(schemaVersion(db)).toBe(3);
  });
});

describe('applyMigrations — display_order backfill', () => {
  it('backfills display_order for rows that have NULL in that column', () => {
    const db = freshBaseDb();
    // Add display_order column with NULLs, then insert two photos
    db.exec('ALTER TABLE photos ADD COLUMN display_order INTEGER');
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('id1', 'a.jpg', 'a.jpg', 100, 100, '2026-01-01T00:00:00Z');
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('id2', 'b.jpg', 'b.jpg', 100, 100, '2026-01-02T00:00:00Z');

    // Both have NULL display_order at this point
    applyMigrations(db);

    const rows = db.prepare('SELECT id, display_order FROM photos ORDER BY created_at').all() as { id: string; display_order: number }[];
    expect(rows[0].display_order).not.toBeNull();
    expect(rows[1].display_order).not.toBeNull();
    expect(rows[0].display_order).toBe(0);
    expect(rows[1].display_order).toBe(1);
  });
});
