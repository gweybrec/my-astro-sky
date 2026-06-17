import type DatabaseConstructor from 'better-sqlite3';

type Database = DatabaseConstructor.Database;

/**
 * Run all pending schema migrations against `database`.
 * Accepts any better-sqlite3 Database instance (including :memory: for tests).
 * Returns the schema version after all migrations have been applied.
 */
export function applyMigrations(database: Database): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL DEFAULT 0
    )
  `);
  const count = (database.prepare('SELECT COUNT(*) AS cnt FROM schema_version').get() as { cnt: number }).cnt;
  if (count === 0) {
    database.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  }

  const getVersion = database.prepare('SELECT version FROM schema_version');
  const setVersion = database.prepare('UPDATE schema_version SET version = ?');

  const migrations: Array<{ version: number; run: (d: Database) => void }> = [
    {
      version: 1,
      run(d) {
        // All additive columns added since the initial schema.
        // try/catch makes each step idempotent on existing databases.
        try { d.exec('ALTER TABLE star_correspondences ADD COLUMN star_ra REAL'); } catch { /* exists */ }
        try { d.exec('ALTER TABLE star_correspondences ADD COLUMN star_dec REAL'); } catch { /* exists */ }
        try { d.exec('ALTER TABLE photos ADD COLUMN manual_placement TEXT'); } catch { /* exists */ }
        try { d.exec("ALTER TABLE photos ADD COLUMN dso_ids TEXT NOT NULL DEFAULT '[]'"); } catch { /* exists */ }
        try { d.exec("ALTER TABLE photos ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'"); } catch { /* exists */ }
        try { d.exec("ALTER TABLE photos ADD COLUMN notes TEXT NOT NULL DEFAULT ''"); } catch { /* exists */ }
        try { d.exec("ALTER TABLE photos ADD COLUMN integrations TEXT NOT NULL DEFAULT '[]'"); } catch { /* exists */ }
        try { d.exec('ALTER TABLE photos ADD COLUMN display_order INTEGER'); } catch { /* exists */ }
        try { d.exec('ALTER TABLE photos ADD COLUMN thumb_filename TEXT'); } catch { /* exists */ }
        try { d.exec('ALTER TABLE photos ADD COLUMN observation_date TEXT'); } catch { /* exists */ }
        // Backfill display_order for any rows present before the column was added.
        d.exec(`
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS rn
            FROM photos
          )
          UPDATE photos
          SET display_order = (SELECT rn FROM ranked WHERE ranked.id = photos.id)
          WHERE display_order IS NULL
        `);
      },
    },
    {
      version: 2,
      run(d) {
        // Per-plan observation night and gear setup.
        try { d.exec('ALTER TABLE plans ADD COLUMN night_of TEXT'); } catch { /* exists */ }
        try { d.exec('ALTER TABLE plans ADD COLUMN setup_id TEXT'); } catch { /* exists */ }
      },
    },
    {
      version: 3,
      run(d) {
        // Plan entries gain a frame position (ra/dec) and allow a null DSO
        // (custom location). SQLite can't drop NOT NULL / UNIQUE in place, so
        // rebuild the table. On a fresh DB the table doesn't exist yet (the base
        // schema, with the new shape, is created after migrations) — skip.
        const exists = d
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plan_entries'")
          .get();
        if (!exists) return;
        const cols = d.prepare("PRAGMA table_info('plan_entries')").all() as Array<{ name: string }>;
        if (cols.some(c => c.name === 'ra')) return; // already migrated
        d.exec(`
          CREATE TABLE plan_entries_new (
            id       TEXT PRIMARY KEY,
            plan_id  TEXT NOT NULL,
            dso_id   TEXT,
            position INTEGER NOT NULL,
            pa_deg   REAL,
            ra       REAL,
            dec      REAL,
            notes    TEXT
          );
          INSERT INTO plan_entries_new (id, plan_id, dso_id, position, pa_deg, notes)
            SELECT id, plan_id, dso_id, position, pa_deg, notes FROM plan_entries;
          DROP TABLE plan_entries;
          ALTER TABLE plan_entries_new RENAME TO plan_entries;
        `);
      },
    },
    // Future migrations: { version: 4, run(d) { ... } },
  ];

  let current = ((getVersion.get() as { version: number }) ?? { version: 0 }).version;
  for (const migration of migrations) {
    if (migration.version > current) {
      migration.run(database);
      setVersion.run(migration.version);
      current = migration.version;
    }
  }
  return current;
}
