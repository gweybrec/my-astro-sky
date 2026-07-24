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
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((r) => r.name);
}

function schemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT version FROM schema_version').get() as
      { version: number } | undefined;
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
    expect(version).toBe(13);
  });

  it('schema_version table contains the latest version', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(schemaVersion(db)).toBe(13);
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
    expect(v).toBe(13);
    expect(schemaVersion(db)).toBe(13);
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
    expect(schemaVersion(db)).toBe(13);
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
    db.prepare(
      'INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, notes) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('e1', 'p1', 'M42', 0, 142, 'note');

    applyMigrations(db);

    const cols = getColumns(db, 'plan_entries');
    expect(cols).toContain('ra');
    expect(cols).toContain('dec');
    // dso_id is now nullable (was NOT NULL) — a null insert must succeed.
    expect(() =>
      db
        .prepare(
          'INSERT INTO plan_entries (id, plan_id, dso_id, position, pa_deg, ra, dec, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('e2', 'p1', null, 1, null, 12.3, 45.6, null),
    ).not.toThrow();

    const row = db.prepare('SELECT * FROM plan_entries WHERE id = ?').get('e1') as any;
    expect(row.dso_id).toBe('M42');
    expect(row.pa_deg).toBe(142);
    expect(schemaVersion(db)).toBe(13);
  });

  it('is idempotent on an already-migrated plan_entries table', () => {
    const db = freshBaseDb();
    withOldPlanEntries(db);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const cols = getColumns(db, 'plan_entries');
    expect(cols.filter((c) => c === 'ra').length).toBe(1);
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
    expect(schemaVersion(db)).toBe(13);
  });
});

describe('applyMigrations — v4 mosaics', () => {
  it('adds the mosaic_id column to plan_entries and creates plan_mosaics', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plan_entries (
        id       TEXT PRIMARY KEY,
        plan_id  TEXT NOT NULL,
        dso_id   TEXT,
        position INTEGER NOT NULL,
        pa_deg   REAL,
        ra       REAL,
        dec      REAL,
        notes    TEXT
      );
    `);
    applyMigrations(db);
    expect(getColumns(db, 'plan_entries')).toContain('mosaic_id');
    const mosaicCols = getColumns(db, 'plan_mosaics');
    expect(mosaicCols).toContain('center_ra');
    expect(mosaicCols).toContain('overlap_pct');
    expect(mosaicCols).toContain('cols');
    expect(schemaVersion(db)).toBe(13);
  });

  it('is idempotent — a second run does not duplicate mosaic_id', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plan_entries (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, dso_id TEXT,
        position INTEGER NOT NULL, pa_deg REAL, ra REAL, dec REAL, notes TEXT
      );
    `);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plan_entries').filter((c) => c === 'mosaic_id').length).toBe(1);
  });
});

describe('applyMigrations — v5 mosaic name', () => {
  it('adds the name column to plan_mosaics', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(getColumns(db, 'plan_mosaics')).toContain('name');
    expect(schemaVersion(db)).toBe(13);
  });

  it('round-trips a stored mosaic name', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    db.prepare(
      'INSERT INTO plan_mosaics (id, plan_id, dso_id, name, center_ra, center_dec) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('mo1', 'p1', null, 'Orion region', 83.5, -5);
    const row = db.prepare('SELECT name FROM plan_mosaics WHERE id = ?').get('mo1') as {
      name: string;
    };
    expect(row.name).toBe('Orion region');
  });

  it('is idempotent — a second run keeps a single name column', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plan_mosaics').filter((c) => c === 'name').length).toBe(1);
  });
});

describe('applyMigrations — v6 smart-scope mosaic size', () => {
  it('adds the mosaic_w_deg / mosaic_h_deg columns to plan_entries', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plan_entries (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, dso_id TEXT,
        position INTEGER NOT NULL, pa_deg REAL, ra REAL, dec REAL, notes TEXT
      );
    `);
    applyMigrations(db);
    const cols = getColumns(db, 'plan_entries');
    expect(cols).toContain('mosaic_w_deg');
    expect(cols).toContain('mosaic_h_deg');
    expect(schemaVersion(db)).toBe(13);
  });

  it('round-trips a stored smart mosaic size and preserves existing rows', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plan_entries (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, dso_id TEXT,
        position INTEGER NOT NULL, pa_deg REAL, ra REAL, dec REAL, notes TEXT
      );
    `);
    db.prepare('INSERT INTO plan_entries (id, plan_id, dso_id, position) VALUES (?, ?, ?, ?)').run(
      'e1',
      'p1',
      'M42',
      0,
    );
    applyMigrations(db);
    db.prepare('UPDATE plan_entries SET mosaic_w_deg = ?, mosaic_h_deg = ? WHERE id = ?').run(
      4.33,
      2.43,
      'e1',
    );
    const row = db.prepare('SELECT * FROM plan_entries WHERE id = ?').get('e1') as any;
    expect(row.dso_id).toBe('M42');
    expect(row.mosaic_w_deg).toBeCloseTo(4.33, 6);
    expect(row.mosaic_h_deg).toBeCloseTo(2.43, 6);
  });

  it('is idempotent — a second run keeps single mosaic size columns', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plan_entries (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, dso_id TEXT,
        position INTEGER NOT NULL, pa_deg REAL, ra REAL, dec REAL, notes TEXT
      );
    `);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plan_entries').filter((c) => c === 'mosaic_w_deg').length).toBe(1);
    expect(getColumns(db, 'plan_entries').filter((c) => c === 'mosaic_h_deg').length).toBe(1);
  });
});

describe('applyMigrations — v7 per-plan observing location', () => {
  it('adds lat and lon columns to an existing plans table', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
        created_at TEXT NOT NULL, night_of TEXT, setup_id TEXT
      );
    `);
    applyMigrations(db);
    const cols = getColumns(db, 'plans');
    expect(cols).toContain('lat');
    expect(cols).toContain('lon');
    expect(schemaVersion(db)).toBe(13);
  });

  it('round-trips a stored per-plan location', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
        created_at TEXT NOT NULL, night_of TEXT, setup_id TEXT
      );
    `);
    db.prepare('INSERT INTO plans (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(
      'p1',
      'Tonight',
      0,
      '2026-06-20',
    );
    applyMigrations(db);
    db.prepare('UPDATE plans SET lat = ?, lon = ? WHERE id = ?').run(48.85, 2.35, 'p1');
    const row = db.prepare('SELECT * FROM plans WHERE id = ?').get('p1') as any;
    expect(row.lat).toBeCloseTo(48.85, 6);
    expect(row.lon).toBeCloseTo(2.35, 6);
  });

  it('is idempotent — a second run keeps single lat/lon columns', () => {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
        created_at TEXT NOT NULL, night_of TEXT, setup_id TEXT
      );
    `);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plans').filter((c) => c === 'lat').length).toBe(1);
    expect(getColumns(db, 'plans').filter((c) => c === 'lon').length).toBe(1);
  });
});

describe('applyMigrations — v8 points of interest', () => {
  it('adds the points_of_interest column to photos and creates poi_categories', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(getColumns(db, 'photos')).toContain('points_of_interest');
    const catCols = getColumns(db, 'poi_categories');
    expect(catCols).toContain('name');
    expect(catCols).toContain('color');
    expect(catCols).toContain('position');
    expect(schemaVersion(db)).toBe(13);
  });

  it('defaults points_of_interest to an empty JSON array', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    db.prepare(
      'INSERT INTO photos (id, filename, original_name, width, height) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'a.jpg', 'a.jpg', 100, 100);
    const row = db.prepare('SELECT points_of_interest FROM photos WHERE id = ?').get('p1') as {
      points_of_interest: string;
    };
    expect(row.points_of_interest).toBe('[]');
  });

  it('round-trips a stored POI category', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    db.prepare('INSERT INTO poi_categories (id, name, color, position) VALUES (?, ?, ?, ?)').run(
      'cat-comet',
      'Comet',
      '#4ea1ff',
      0,
    );
    const row = db.prepare('SELECT * FROM poi_categories WHERE id = ?').get('cat-comet') as any;
    expect(row.name).toBe('Comet');
    expect(row.color).toBe('#4ea1ff');
  });

  it('is idempotent — a second run keeps a single points_of_interest column', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'photos').filter((c) => c === 'points_of_interest').length).toBe(1);
  });
});

describe('applyMigrations — v9 supernova type + ISS recolor', () => {
  /** Apply v1..v8 only, then seed the original 4 default types (pre-v9 state). */
  function seededPreV9(db: Database.Database) {
    // Build the schema up to v8 by inserting a version row at 8 before running.
    applyMigrations(db); // brings to latest, creates poi_categories
    db.exec('DELETE FROM poi_categories');
    db.prepare('UPDATE schema_version SET version = 8').run();
    const ins = db.prepare(
      'INSERT INTO poi_categories (id, name, color, position) VALUES (?, ?, ?, ?)',
    );
    ins.run('cat-comet', 'Comet', '#4ea1ff', 0);
    ins.run('cat-asteroid', 'Asteroid', '#c9a227', 1);
    ins.run('cat-satellite', 'Satellite', '#7bd88f', 2);
    ins.run('cat-iss', 'ISS', '#ff7b7b', 3);
  }

  it('adds the Supernova type and recolors ISS to light grey on a seeded DB', () => {
    const db = freshBaseDb();
    seededPreV9(db);
    applyMigrations(db);
    const rows = db.prepare('SELECT id, color FROM poi_categories').all() as {
      id: string;
      color: string;
    }[];
    expect(rows.find((r) => r.id === 'cat-supernova')?.color).toBe('#ff5a5a');
    expect(rows.find((r) => r.id === 'cat-iss')?.color).toBe('#cbd5e1');
  });

  it('does not seed Supernova on a fresh (empty) DB — db.ts seeds all 5 there', () => {
    const db = freshBaseDb();
    applyMigrations(db); // poi_categories created but empty; v9 must skip
    const cnt = (db.prepare('SELECT COUNT(*) AS c FROM poi_categories').get() as { c: number }).c;
    expect(cnt).toBe(0);
  });

  it('respects a user-customized ISS colour (only the default red is recolored)', () => {
    const db = freshBaseDb();
    seededPreV9(db);
    db.prepare("UPDATE poi_categories SET color = '#123456' WHERE id = 'cat-iss'").run();
    applyMigrations(db);
    const iss = db.prepare("SELECT color FROM poi_categories WHERE id = 'cat-iss'").get() as {
      color: string;
    };
    expect(iss.color).toBe('#123456');
  });
});

describe('applyMigrations — v10 observation windows', () => {
  /** Pre-v10 plan_entries: has a mosaic size but no observation_windows column. */
  function withPreV10PlanEntries(db: Database.Database) {
    db.exec(`
      CREATE TABLE plan_entries (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, dso_id TEXT, position INTEGER NOT NULL,
        pa_deg REAL, ra REAL, dec REAL, notes TEXT,
        mosaic_id TEXT, mosaic_w_deg REAL, mosaic_h_deg REAL
      );
    `);
  }

  it('adds the observation_windows column (default []) to plan_entries', () => {
    const db = freshBaseDb();
    withPreV10PlanEntries(db);
    db.prepare('INSERT INTO plan_entries (id, plan_id, dso_id, position) VALUES (?, ?, ?, ?)').run(
      'e1',
      'p1',
      'M42',
      0,
    );
    applyMigrations(db);
    expect(getColumns(db, 'plan_entries')).toContain('observation_windows');
    const row = db
      .prepare('SELECT observation_windows FROM plan_entries WHERE id = ?')
      .get('e1') as {
      observation_windows: string;
    };
    expect(row.observation_windows).toBe('[]');
    expect(schemaVersion(db)).toBe(13);
  });

  it('is idempotent — a second run keeps a single observation_windows column', () => {
    const db = freshBaseDb();
    withPreV10PlanEntries(db);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plan_entries').filter((c) => c === 'observation_windows').length).toBe(
      1,
    );
  });
});

describe('applyMigrations — v11 per-plan objects-list sort', () => {
  /** Pre-v11 plans table: has per-plan location but no sort_by column. */
  function withPreV11Plans(db: Database.Database) {
    db.exec(`
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
        created_at TEXT NOT NULL, night_of TEXT, setup_id TEXT, lat REAL, lon REAL
      );
    `);
  }

  it("adds the sort_by column (default 'transit') to an existing plans table", () => {
    const db = freshBaseDb();
    withPreV11Plans(db);
    db.prepare('INSERT INTO plans (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(
      'p1',
      'Tonight',
      0,
      '2026-07-07',
    );
    applyMigrations(db);
    expect(getColumns(db, 'plans')).toContain('sort_by');
    const row = db.prepare('SELECT sort_by FROM plans WHERE id = ?').get('p1') as {
      sort_by: string;
    };
    expect(row.sort_by).toBe('transit');
    expect(schemaVersion(db)).toBe(13);
  });

  it('round-trips a stored sort key', () => {
    const db = freshBaseDb();
    withPreV11Plans(db);
    db.prepare('INSERT INTO plans (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(
      'p1',
      'Tonight',
      0,
      '2026-07-07',
    );
    applyMigrations(db);
    db.prepare('UPDATE plans SET sort_by = ? WHERE id = ?').run('window', 'p1');
    const row = db.prepare('SELECT sort_by FROM plans WHERE id = ?').get('p1') as {
      sort_by: string;
    };
    expect(row.sort_by).toBe('window');
  });

  it('is idempotent — a second run keeps a single sort_by column', () => {
    const db = freshBaseDb();
    withPreV11Plans(db);
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'plans').filter((c) => c === 'sort_by').length).toBe(1);
  });
});

describe('applyMigrations — v12 photo capture details + gear setup link', () => {
  it('adds capture_details (default {}) and gear_setup_id columns to photos', () => {
    const db = freshBaseDb();
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('id1', 'a.jpg', 'a.jpg', 100, 100, '2026-01-01T00:00:00Z');
    applyMigrations(db);
    const cols = getColumns(db, 'photos');
    expect(cols).toContain('capture_details');
    expect(cols).toContain('gear_setup_id');
    const row = db
      .prepare('SELECT capture_details, gear_setup_id FROM photos WHERE id = ?')
      .get('id1') as { capture_details: string; gear_setup_id: string | null };
    expect(row.capture_details).toBe('{}');
    expect(row.gear_setup_id).toBeNull();
    expect(schemaVersion(db)).toBe(13);
  });

  it('round-trips capture details and a setup id', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at, capture_details, gear_setup_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('id1', 'a.jpg', 'a.jpg', 100, 100, '2026-01-01T00:00:00Z', '{"gain":120}', 'setup-1');
    const row = db
      .prepare('SELECT capture_details, gear_setup_id FROM photos WHERE id = ?')
      .get('id1') as { capture_details: string; gear_setup_id: string | null };
    expect(row.capture_details).toBe('{"gain":120}');
    expect(row.gear_setup_id).toBe('setup-1');
  });

  it('is idempotent — a second run keeps single columns', () => {
    const db = freshBaseDb();
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(getColumns(db, 'photos').filter((c) => c === 'capture_details').length).toBe(1);
    expect(getColumns(db, 'photos').filter((c) => c === 'gear_setup_id').length).toBe(1);
  });
});

describe('applyMigrations — display_order backfill', () => {
  it('backfills display_order for rows that have NULL in that column', () => {
    const db = freshBaseDb();
    // Add display_order column with NULLs, then insert two photos
    db.exec('ALTER TABLE photos ADD COLUMN display_order INTEGER');
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('id1', 'a.jpg', 'a.jpg', 100, 100, '2026-01-01T00:00:00Z');
    db.prepare(
      `INSERT INTO photos (id, filename, original_name, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('id2', 'b.jpg', 'b.jpg', 100, 100, '2026-01-02T00:00:00Z');

    // Both have NULL display_order at this point
    applyMigrations(db);

    const rows = db.prepare('SELECT id, display_order FROM photos ORDER BY created_at').all() as {
      id: string;
      display_order: number;
    }[];
    expect(rows[0].display_order).not.toBeNull();
    expect(rows[1].display_order).not.toBeNull();
    expect(rows[0].display_order).toBe(0);
    expect(rows[1].display_order).toBe(1);
  });
});

describe('applyMigrations — custom_gear accepts the filter type (v13)', () => {
  /** The pre-v13 table: a CHECK constraint listing only the three setup types. */
  function dbWithLegacyCustomGear(): Database.Database {
    const db = freshBaseDb();
    db.exec(`
      CREATE TABLE custom_gear (
        id   TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('telescope','camera','accessory')),
        data TEXT NOT NULL
      );
    `);
    return db;
  }

  it('rejects a filter row before migrating', () => {
    const db = dbWithLegacyCustomGear();
    expect(() =>
      db
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('c1', 'filter', '{}'),
    ).toThrow();
  });

  it('accepts a filter row after migrating', () => {
    const db = dbWithLegacyCustomGear();
    applyMigrations(db);
    expect(() =>
      db
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('c1', 'filter', '{}'),
    ).not.toThrow();
  });

  it('preserves existing custom gear rows through the table rebuild', () => {
    const db = dbWithLegacyCustomGear();
    const insert = db.prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)');
    insert.run('custom-1', 'telescope', '{"brand":"Acme"}');
    insert.run('custom-2', 'camera', '{"brand":"Zwo"}');

    applyMigrations(db);

    const rows = db.prepare('SELECT id, type, data FROM custom_gear ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'custom-1', type: 'telescope', data: '{"brand":"Acme"}' },
      { id: 'custom-2', type: 'camera', data: '{"brand":"Zwo"}' },
    ]);
  });

  it('still rejects an unknown type after migrating', () => {
    const db = dbWithLegacyCustomGear();
    applyMigrations(db);
    expect(() =>
      db
        .prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)')
        .run('c1', 'mount', '{}'),
    ).toThrow();
  });

  it('is idempotent — re-running leaves the table and its rows intact', () => {
    const db = dbWithLegacyCustomGear();
    applyMigrations(db);
    db.prepare('INSERT INTO custom_gear (id, type, data) VALUES (?, ?, ?)').run(
      'c1',
      'filter',
      '{}',
    );
    applyMigrations(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_gear').get()).toEqual({ n: 1 });
  });
});
