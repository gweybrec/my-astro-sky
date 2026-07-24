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
  const count = (
    database.prepare('SELECT COUNT(*) AS cnt FROM schema_version').get() as { cnt: number }
  ).cnt;
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
        try {
          d.exec('ALTER TABLE star_correspondences ADD COLUMN star_ra REAL');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE star_correspondences ADD COLUMN star_dec REAL');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE photos ADD COLUMN manual_placement TEXT');
        } catch {
          /* exists */
        }
        try {
          d.exec("ALTER TABLE photos ADD COLUMN dso_ids TEXT NOT NULL DEFAULT '[]'");
        } catch {
          /* exists */
        }
        try {
          d.exec("ALTER TABLE photos ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'");
        } catch {
          /* exists */
        }
        try {
          d.exec("ALTER TABLE photos ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
        } catch {
          /* exists */
        }
        try {
          d.exec("ALTER TABLE photos ADD COLUMN integrations TEXT NOT NULL DEFAULT '[]'");
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE photos ADD COLUMN display_order INTEGER');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE photos ADD COLUMN thumb_filename TEXT');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE photos ADD COLUMN observation_date TEXT');
        } catch {
          /* exists */
        }
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
        try {
          d.exec('ALTER TABLE plans ADD COLUMN night_of TEXT');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE plans ADD COLUMN setup_id TEXT');
        } catch {
          /* exists */
        }
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
        const cols = d.prepare("PRAGMA table_info('plan_entries')").all() as Array<{
          name: string;
        }>;
        if (cols.some((c) => c.name === 'ra')) return; // already migrated
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
    {
      version: 4,
      run(d) {
        // Mosaics: a group of tile entries covering one target. Tiles are plan
        // entries tagged with a mosaic_id; the mosaic row holds the group params.
        try {
          d.exec('ALTER TABLE plan_entries ADD COLUMN mosaic_id TEXT');
        } catch {
          /* exists */
        }
        d.exec(`
          CREATE TABLE IF NOT EXISTS plan_mosaics (
            id          TEXT PRIMARY KEY,
            plan_id     TEXT NOT NULL,
            dso_id      TEXT,
            center_ra   REAL NOT NULL,
            center_dec  REAL NOT NULL,
            pa_deg      REAL NOT NULL DEFAULT 0,
            overlap_pct REAL NOT NULL DEFAULT 20,
            cols        INTEGER NOT NULL DEFAULT 1,
            rows        INTEGER NOT NULL DEFAULT 1,
            position    INTEGER NOT NULL DEFAULT 0
          );
        `);
      },
    },
    {
      // v5: mosaics gain an explicit user-supplied name (multi-DSO mosaics can't
      // be named after a single target). Older mosaics keep NULL → name is still
      // derived from the DSO at display time.
      version: 5,
      run(d) {
        try {
          d.exec('ALTER TABLE plan_mosaics ADD COLUMN name TEXT');
        } catch {
          /* exists */
        }
      },
    },
    {
      // v6: plan entries gain an optional smart-scope single-frame mosaic size.
      // A smart telescope (Seestar, Vespera, DWARF…) enlarges one frame rather
      // than tiling a grid; these columns hold the chosen FOV (deg). NULL ⇒ the
      // frame renders at its native FOV.
      version: 6,
      run(d) {
        try {
          d.exec('ALTER TABLE plan_entries ADD COLUMN mosaic_w_deg REAL');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE plan_entries ADD COLUMN mosaic_h_deg REAL');
        } catch {
          /* exists */
        }
      },
    },
    {
      // v7: per-plan observing location (°N / °E). NULL ⇒ fall back to the
      // global location (same pattern as night_of falling back to the global date).
      version: 7,
      run(d) {
        try {
          d.exec('ALTER TABLE plans ADD COLUMN lat REAL');
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE plans ADD COLUMN lon REAL');
        } catch {
          /* exists */
        }
      },
    },
    {
      // v8: Points of Interest — non-DSO objects (comets, asteroids, satellites…)
      // tagged on photos, each referencing a user-managed category. Categories are a
      // global entity (like gear_setups); the per-photo POIs live in a JSON column.
      version: 8,
      run(d) {
        try {
          d.exec("ALTER TABLE photos ADD COLUMN points_of_interest TEXT NOT NULL DEFAULT '[]'");
        } catch {
          /* exists */
        }
        d.exec(`
          CREATE TABLE IF NOT EXISTS poi_categories (
            id       TEXT PRIMARY KEY,
            name     TEXT NOT NULL DEFAULT '',
            color    TEXT NOT NULL DEFAULT '#888888',
            position INTEGER NOT NULL DEFAULT 0
          );
        `);
      },
    },
    {
      // v9: add the "Supernova" default POI type (red) and recolor the ISS type to
      // light grey, for databases that were already seeded with the original 4 types.
      // A fresh DB has an empty poi_categories here (it is seeded afterwards in db.ts
      // with all 5 defaults) — so skip, to avoid leaving only Supernova behind.
      version: 9,
      run(d) {
        const seeded =
          (d.prepare('SELECT COUNT(*) AS cnt FROM poi_categories').get() as { cnt: number }).cnt >
          0;
        if (!seeded) return;
        try {
          d.prepare(
            "INSERT OR IGNORE INTO poi_categories (id, name, color, position) VALUES ('cat-supernova', 'Supernova', '#ff5a5a', 4)",
          ).run();
        } catch {
          /* ignore */
        }
        // Only recolor ISS if it still has the original default colour (respect user edits).
        try {
          d.prepare(
            "UPDATE poi_categories SET color = '#cbd5e1' WHERE id = 'cat-iss' AND color = '#ff7b7b'",
          ).run();
        } catch {
          /* ignore */
        }
      },
    },
    {
      // v10: plan entries gain user-drawn observation windows on the night
      // trajectory — a JSON array of {id, startFrac, endFrac, filter, color}.
      // NULL/absent ⇒ no windows (column defaults to '[]').
      version: 10,
      run(d) {
        try {
          d.exec(
            "ALTER TABLE plan_entries ADD COLUMN observation_windows TEXT NOT NULL DEFAULT '[]'",
          );
        } catch {
          /* exists */
        }
      },
    },
    {
      // v11: plans gain a per-plan objects-list sort key (drives both the UI
      // list order and the exported PDF). NULL/absent ⇒ 'transit' (the previous
      // hard-coded order).
      version: 11,
      run(d) {
        try {
          d.exec("ALTER TABLE plans ADD COLUMN sort_by TEXT NOT NULL DEFAULT 'transit'");
        } catch {
          /* exists */
        }
      },
    },
    {
      // v12: photos gain a parsed capture-details JSON blob (gain, sensor temp,
      // focal length, …) and an optional link to a gear setup. capture_details
      // defaults to '{}'; gear_setup_id is a nullable FK into gear_setups (the
      // link dangles harmlessly if the setup is later deleted — resolved defensively).
      version: 12,
      run(d) {
        try {
          d.exec("ALTER TABLE photos ADD COLUMN capture_details TEXT NOT NULL DEFAULT '{}'");
        } catch {
          /* exists */
        }
        try {
          d.exec('ALTER TABLE photos ADD COLUMN gear_setup_id TEXT');
        } catch {
          /* exists */
        }
      },
    },
    {
      // v13: custom_gear accepts a fourth type, 'filter'. The type column carries a
      // CHECK constraint, which SQLite cannot alter in place — the table has to be
      // rebuilt and its rows copied across. Guarded by a check of the existing
      // constraint text so it is a no-op on a database already carrying it.
      version: 13,
      run(d) {
        const row = d
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'custom_gear'")
          .get() as { sql: string } | undefined;
        if (!row || row.sql.includes("'filter'")) return;

        d.exec(`
          CREATE TABLE custom_gear_new (
            id   TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('telescope','camera','accessory','filter')),
            data TEXT NOT NULL
          );
          INSERT INTO custom_gear_new (id, type, data) SELECT id, type, data FROM custom_gear;
          DROP TABLE custom_gear;
          ALTER TABLE custom_gear_new RENAME TO custom_gear;
        `);
      },
    },
    // Future migrations: { version: 14, run(d) { ... } },
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
