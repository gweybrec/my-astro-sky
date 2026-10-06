/**
 * User-configurable solver and API settings, stored as key/value rows. A secret setting (the
 * Astrometry API key) is encrypted at rest through the `SecretCodec` port, and an environment value
 * wins over the stored one for it.
 */
import { DomainError } from '../domain/errors';
import type { ServerSettings, SettingsChanges } from '../domain/settings';
import type { EnvSource } from '../ports/env-source';
import type { SecretCodec } from '../ports/secret-codec';
import type { SqlDb, SqlStatement } from '../ports/sql-db';

export interface SettingsServiceDeps {
  db: SqlDb;
  secrets: SecretCodec;
  env: EnvSource;
  /** What the host runs on; the settings screen shows WSL switches on Windows only. */
  platform: { isWindows: boolean };
  /** Called after the API key was written or removed, so a session opened with the old key can be dropped. */
  onApiKeyChanged?: () => void;
}

export interface SettingsService {
  /**
   * The value of a setting. A secret setting: the environment value if there is one, else the stored one
   * (decrypted; a plain stored value is re-encrypted in place when a key is configured; `undefined` when it
   * cannot be decrypted). Other settings: the stored value, else the environment value.
   */
  get(key: string): Promise<string | undefined>;
  /** Stores a value, encrypted when the setting is secret and a key is configured. */
  set(key: string, value: string): Promise<void>;
  /** Removes the stored value (an environment value stays visible through `get`). */
  remove(key: string): Promise<void>;
  /** What `GET /api/settings` returns, `isWindows` included. The secret's value is never returned, only `apiKeySet`. */
  readPublic(): Promise<ServerSettings>;
  /**
   * Applies a `PUT /api/settings` body in one transaction. Throws `conflict` (code `SETTING_LOCKED_BY_ENV`)
   * for a new API key when the environment defines it. `apiKeyChanged` is true when a key was written
   * (`onApiKeyChanged` has then been called).
   */
  update(body: SettingsChanges): Promise<{ apiKeyChanged: boolean }>;
  /** Removes the stored API key and calls `onApiKeyChanged`. Throws `conflict` (code `SETTING_LOCKED_BY_ENV`) when the environment defines it. */
  removeApiKey(): Promise<void>;
}

/** Settings whose value is encrypted at rest and never returned by the API. */
export const SECRET_SETTINGS: ReadonlySet<string> = new Set(['ASTROMETRY_API_KEY']);
/** Settings edited as text: written when the body has a string for them, trimmed, even when empty. */
export const EDITABLE_STRING_SETTINGS = [
  'ASTAP_PATH',
  'SOLVE_FIELD_PATH',
  'ASTROMETRY_DATA_DIR',
  'MAX_PARALLEL_SOLVES',
] as const;
/** Settings edited as switches: written as `'1'` or `'0'` when the body has a boolean for them. */
export const EDITABLE_BOOLEAN_SETTINGS = ['USE_WSL_FOR_SOLVE_FIELD', 'USE_WSL_FOR_ASTAP'] as const;

const API_KEY = 'ASTROMETRY_API_KEY';
const SET_SQL = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';

function lockedByEnv(): DomainError {
  const message = `${API_KEY} is managed via environment variable and cannot be changed here`;
  return new DomainError('conflict', message, {
    code: 'SETTING_LOCKED_BY_ENV',
    body: { error: message, code: 'SETTING_LOCKED_BY_ENV', key: API_KEY },
  });
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { db, secrets, env, platform, onApiKeyChanged } = deps;

  /** The value of a setting given its stored value (`undefined` when no row). May re-encrypt a plain secret. */
  async function resolve(key: string, stored: string | undefined): Promise<string | undefined> {
    const secret = SECRET_SETTINGS.has(key);
    if (secret && env(key) !== undefined) return env(key);

    const row = stored === undefined ? undefined : { value: stored };
    if (row === undefined) return env(key);
    if (!secret) return row.value;

    const decrypted = await secrets.decrypt(row.value);
    // An encrypted row that cannot be decrypted: do not leak the ciphertext.
    if (decrypted === null) return undefined;

    // Best-effort migration of a plain stored secret to encrypted storage when a key is configured.
    if (!secrets.isEncrypted(row.value) && secrets.canEncrypt()) {
      const encrypted = await secrets.encrypt(row.value);
      if (encrypted !== row.value) await db.run(SET_SQL, [key, encrypted]);
    }
    return decrypted;
  }

  async function get(key: string): Promise<string | undefined> {
    if (SECRET_SETTINGS.has(key) && env(key) !== undefined) return env(key);
    const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return resolve(key, row?.value);
  }

  return {
    get,

    async set(key, value) {
      const stored = SECRET_SETTINGS.has(key) ? await secrets.encrypt(value) : value;
      await db.run(SET_SQL, [key, stored]);
    },

    async remove(key) {
      await db.run('DELETE FROM settings WHERE key = ?', [key]);
    },

    async readPublic() {
      // One query for every key; the rule for each value is the one of `get`.
      const keys = [API_KEY, ...EDITABLE_STRING_SETTINGS, ...EDITABLE_BOOLEAN_SETTINGS];
      const rows = await db.all<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`,
        keys,
      );
      const stored = new Map(rows.map((r) => [r.key, r.value]));
      const apiKeySet = !!(await resolve(API_KEY, stored.get(API_KEY)));
      const strings: Record<string, string> = {};
      for (const key of EDITABLE_STRING_SETTINGS) {
        strings[key] = (await resolve(key, stored.get(key))) ?? '';
      }
      const flags: Record<string, boolean> = {};
      for (const key of EDITABLE_BOOLEAN_SETTINGS) {
        const value = ((await resolve(key, stored.get(key))) ?? '').trim().toLowerCase();
        flags[key] = value === '1' || value === 'true' || value === 'yes' || value === 'on';
      }
      return {
        apiKeySet,
        isWindows: platform.isWindows,
        ...strings,
        ...flags,
      } as ServerSettings;
    },

    async update(input) {
      // Typed for callers, still checked at run time: a screen or a restored backup can pass anything.
      const body = (input ?? {}) as Record<string, unknown>;
      const writes: SqlStatement[] = [];
      let apiKeyChanged = false;

      // API key: only update when the user provides a non-empty value.
      if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
        if (env(API_KEY) !== undefined) throw lockedByEnv();
        // Encrypt before the transaction opens: its body may only await `tx` calls.
        writes.push({ sql: SET_SQL, params: [API_KEY, await secrets.encrypt(body.apiKey.trim())] });
        apiKeyChanged = true;
      }
      for (const key of EDITABLE_STRING_SETTINGS) {
        const value = body[key];
        if (typeof value === 'string') writes.push({ sql: SET_SQL, params: [key, value.trim()] });
      }
      for (const key of EDITABLE_BOOLEAN_SETTINGS) {
        const value = body[key];
        if (typeof value === 'boolean')
          writes.push({ sql: SET_SQL, params: [key, value ? '1' : '0'] });
      }

      if (writes.length > 0) await db.batch(writes);
      if (apiKeyChanged) onApiKeyChanged?.();
      return { apiKeyChanged };
    },

    async removeApiKey() {
      if (env(API_KEY) !== undefined) throw lockedByEnv();
      await db.run('DELETE FROM settings WHERE key = ?', [API_KEY]);
      onApiKeyChanged?.();
    },
  };
}
