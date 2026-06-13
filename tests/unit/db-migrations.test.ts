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

  it('returns schema version 1 after first run', () => {
    const db = freshBaseDb();
    const version = applyMigrations(db);
    expect(version).toBe(1);
  });

  it('schema_version table contains version 1', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(schemaVersion(db)).toBe(1);
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
    expect(v).toBe(1);
    expect(schemaVersion(db)).toBe(1);
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
    expect(schemaVersion(db)).toBe(1);
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
