// @vitest-environment node
/**
 * The settings service (WP2.3d): the rules on a private in-memory database with a fake codec and
 * environment. The real codec is exercised by settings-security.test.ts.
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSchema } from '@myastrosky/core/db/schema';
import { DomainError, isDomainError } from '@myastrosky/core/domain/errors';
import type { SecretCodec } from '@myastrosky/core/ports/secret-codec';
import type { SqlDb } from '@myastrosky/core/ports/sql-db';
import {
  createSettingsService,
  EDITABLE_BOOLEAN_SETTINGS,
  EDITABLE_STRING_SETTINGS,
  SECRET_SETTINGS,
  type SettingsService,
} from '@myastrosky/core/services/settings';
import { createBetterSqliteDb } from '../../server/sqlite-adapter';
import { SQL_ADAPTERS } from '../helpers/sql-adapters';
import { countingSqlDb, type CountingSqlDb } from '../helpers/counting-sql-db';

const LOCKED_BODY = {
  error: 'ASTROMETRY_API_KEY is managed via environment variable and cannot be changed here',
  code: 'SETTING_LOCKED_BY_ENV',
  key: 'ASTROMETRY_API_KEY',
};

/** A codec that "encrypts" by adding a prefix; `enabled` stands for a configured key. */
function fakeCodec(state: { enabled: boolean }): SecretCodec {
  return {
    canEncrypt: () => state.enabled,
    encrypt: async (plain) => (state.enabled ? `fake:${plain}` : plain),
    decrypt: async (stored) => {
      if (!stored.startsWith('fake:')) return stored;
      if (!state.enabled || stored === 'fake:') return null;
      return stored.slice('fake:'.length);
    },
    isEncrypted: (stored) => stored.startsWith('fake:'),
  };
}

describe.each(SQL_ADAPTERS)('SettingsService (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: SqlDb;
  let svc: SettingsService;
  let codec: { enabled: boolean };
  let env: Record<string, string | undefined>;
  let keyChanges: number;

  beforeEach(async () => {
    conn = new Database(':memory:');
    db = wrap(createBetterSqliteDb(conn));
    await initSchema(db);
    codec = { enabled: false };
    env = {};
    keyChanges = 0;
    svc = createSettingsService({
      db,
      secrets: fakeCodec(codec),
      env: (k) => env[k],
      platform: { isWindows: false },
      onApiKeyChanged: () => {
        keyChanges++;
      },
    });
  });
  afterEach(() => conn.close());

  const stored = (key: string): string | undefined =>
    (
      conn.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;

  const rejection = async (p: Promise<unknown>): Promise<DomainError> => {
    try {
      await p;
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      return e as DomainError;
    }
    throw new Error('expected the promise to reject');
  };

  it('knows the secret and editable keys', () => {
    expect([...SECRET_SETTINGS]).toEqual(['ASTROMETRY_API_KEY']);
    expect([...EDITABLE_STRING_SETTINGS]).toEqual([
      'ASTAP_PATH',
      'SOLVE_FIELD_PATH',
      'ASTROMETRY_DATA_DIR',
      'MAX_PARALLEL_SOLVES',
    ]);
    expect([...EDITABLE_BOOLEAN_SETTINGS]).toEqual([
      'USE_WSL_FOR_SOLVE_FIELD',
      'USE_WSL_FOR_ASTAP',
    ]);
  });

  describe('get, other keys', () => {
    it('returns undefined when there is no row and no environment value', async () => {
      expect(await svc.get('ASTAP_PATH')).toBeUndefined();
    });

    it('falls back to the environment when there is no row', async () => {
      env.ASTAP_PATH = '/env/astap';
      expect(await svc.get('ASTAP_PATH')).toBe('/env/astap');
    });

    it('prefers the stored value to the environment', async () => {
      env.ASTAP_PATH = '/env/astap';
      await svc.set('ASTAP_PATH', '/db/astap');
      expect(await svc.get('ASTAP_PATH')).toBe('/db/astap');
    });

    it('returns an empty stored value, not the environment value', async () => {
      env.ASTAP_PATH = '/env/astap';
      await svc.set('ASTAP_PATH', '');
      expect(await svc.get('ASTAP_PATH')).toBe('');
    });

    it('does not run a non-secret value through the codec', async () => {
      codec.enabled = true;
      await svc.set('ASTAP_PATH', '/db/astap');
      expect(stored('ASTAP_PATH')).toBe('/db/astap');
    });
  });

  describe('get, the secret key', () => {
    it('returns the environment value without reading the database', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'db-key');
      env.ASTROMETRY_API_KEY = 'env-key';
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('env-key');
    });

    it('returns an empty environment value as defined', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'db-key');
      env.ASTROMETRY_API_KEY = '';
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('');
    });

    it('returns the stored value when the environment is unset', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'db-key');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('db-key');
    });

    it('returns undefined when there is no row and no environment value', async () => {
      expect(await svc.get('ASTROMETRY_API_KEY')).toBeUndefined();
    });

    it('stores the secret encrypted when a key is configured and reads it back', async () => {
      codec.enabled = true;
      await svc.set('ASTROMETRY_API_KEY', 'secret');
      expect(stored('ASTROMETRY_API_KEY')).toBe('fake:secret');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('secret');
    });

    it('stores the secret as plain text when no key is configured', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'secret');
      expect(stored('ASTROMETRY_API_KEY')).toBe('secret');
    });

    it('returns undefined for an encrypted value that cannot be decrypted', async () => {
      codec.enabled = true;
      await svc.set('ASTROMETRY_API_KEY', 'secret');
      codec.enabled = false;
      expect(await svc.get('ASTROMETRY_API_KEY')).toBeUndefined();
      expect(stored('ASTROMETRY_API_KEY')).toBe('fake:secret');
    });

    it('returns undefined for a corrupted encrypted value', async () => {
      codec.enabled = true;
      conn
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('ASTROMETRY_API_KEY', 'fake:');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBeUndefined();
    });

    it('re-encrypts a plain stored secret in place when a key is configured, and returns it', async () => {
      conn
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('ASTROMETRY_API_KEY', 'plain');
      codec.enabled = true;
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('plain');
      expect(stored('ASTROMETRY_API_KEY')).toBe('fake:plain');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('plain');
    });

    it('leaves a plain stored secret as it is when no key is configured', async () => {
      conn
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('ASTROMETRY_API_KEY', 'plain');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('plain');
      expect(stored('ASTROMETRY_API_KEY')).toBe('plain');
    });
  });

  describe('set and remove', () => {
    it('replaces an existing value', async () => {
      await svc.set('SOLVE_FIELD_PATH', 'a');
      await svc.set('SOLVE_FIELD_PATH', 'b');
      expect(await svc.get('SOLVE_FIELD_PATH')).toBe('b');
    });

    it('removes a stored value and does nothing for a missing one', async () => {
      await svc.set('SOLVE_FIELD_PATH', 'a');
      await svc.remove('SOLVE_FIELD_PATH');
      await svc.remove('SOLVE_FIELD_PATH');
      expect(await svc.get('SOLVE_FIELD_PATH')).toBeUndefined();
    });

    it('keeps the environment value visible after removing a stored secret', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'db-key');
      await svc.remove('ASTROMETRY_API_KEY');
      env.ASTROMETRY_API_KEY = 'env-key';
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('env-key');
    });
  });

  describe('readPublic', () => {
    it('returns the defaults on an empty database, in the order the route sends them', async () => {
      const result = await svc.readPublic();
      expect(result).toEqual({
        apiKeySet: false,
        isWindows: false,
        ASTAP_PATH: '',
        SOLVE_FIELD_PATH: '',
        ASTROMETRY_DATA_DIR: '',
        MAX_PARALLEL_SOLVES: '',
        USE_WSL_FOR_SOLVE_FIELD: false,
        USE_WSL_FOR_ASTAP: false,
      });
      expect(Object.keys(result)).toEqual([
        'apiKeySet',
        'isWindows',
        'ASTAP_PATH',
        'SOLVE_FIELD_PATH',
        'ASTROMETRY_DATA_DIR',
        'MAX_PARALLEL_SOLVES',
        'USE_WSL_FOR_SOLVE_FIELD',
        'USE_WSL_FOR_ASTAP',
      ]);
    });

    it('reports the platform it was given', async () => {
      const windows = createSettingsService({
        db,
        secrets: fakeCodec(codec),
        env: (k) => env[k],
        platform: { isWindows: true },
      });
      expect((await windows.readPublic()).isWindows).toBe(true);
    });

    it('reports stored values and environment fallbacks', async () => {
      await svc.set('ASTAP_PATH', '/db/astap');
      env.SOLVE_FIELD_PATH = '/env/solve-field';
      env.MAX_PARALLEL_SOLVES = '3';
      const result = await svc.readPublic();
      expect(result.ASTAP_PATH).toBe('/db/astap');
      expect(result.SOLVE_FIELD_PATH).toBe('/env/solve-field');
      expect(result.MAX_PARALLEL_SOLVES).toBe('3');
    });

    it.each([
      ['1', true],
      ['true', true],
      [' YES ', true],
      ['On', true],
      ['0', false],
      ['false', false],
      ['', false],
      ['2', false],
    ])('reads the switch value %j as %s', async (value, expected) => {
      await svc.set('USE_WSL_FOR_ASTAP', value);
      expect((await svc.readPublic()).USE_WSL_FOR_ASTAP).toBe(expected);
    });

    it('never returns the secret, only whether it is set', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'super-secret');
      const result = await svc.readPublic();
      expect(result.apiKeySet).toBe(true);
      expect(JSON.stringify(result)).not.toContain('super-secret');
    });

    it('reports a key set by the environment as set', async () => {
      env.ASTROMETRY_API_KEY = 'env-key';
      expect((await svc.readPublic()).apiKeySet).toBe(true);
    });

    it('reports an undecryptable key as not set', async () => {
      codec.enabled = true;
      await svc.set('ASTROMETRY_API_KEY', 'secret');
      codec.enabled = false;
      expect((await svc.readPublic()).apiKeySet).toBe(false);
    });
  });

  describe('update', () => {
    it('writes a trimmed API key and reports the change', async () => {
      codec.enabled = true;
      expect(await svc.update({ apiKey: '  abc  ' })).toEqual({ apiKeyChanged: true });
      expect(stored('ASTROMETRY_API_KEY')).toBe('fake:abc');
      expect(await svc.get('ASTROMETRY_API_KEY')).toBe('abc');
    });

    it.each([[''], ['   '], [42], [null], [undefined]])(
      'ignores the API key %j and leaves the stored one',
      async (apiKey) => {
        await svc.set('ASTROMETRY_API_KEY', 'old');
        expect(await svc.update({ apiKey })).toEqual({ apiKeyChanged: false });
        expect(stored('ASTROMETRY_API_KEY')).toBe('old');
      },
    );

    it('refuses a new API key when the environment defines it, with the exact 409 body, and writes nothing', async () => {
      env.ASTROMETRY_API_KEY = 'env-key';
      const err = await rejection(svc.update({ apiKey: 'x', ASTAP_PATH: '/p' }));
      expect(err.kind).toBe('conflict');
      expect(err.code).toBe('SETTING_LOCKED_BY_ENV');
      expect(err.body).toEqual(LOCKED_BODY);
      expect(stored('ASTAP_PATH')).toBeUndefined();
      expect(stored('ASTROMETRY_API_KEY')).toBeUndefined();
    });

    it('accepts a blank API key when the environment defines it', async () => {
      env.ASTROMETRY_API_KEY = 'env-key';
      expect(await svc.update({ apiKey: '  ', ASTAP_PATH: '/p' })).toEqual({
        apiKeyChanged: false,
      });
      expect(stored('ASTAP_PATH')).toBe('/p');
    });

    it('writes the four string settings trimmed, even when empty', async () => {
      await svc.set('ASTAP_PATH', 'old');
      await svc.update({
        ASTAP_PATH: '',
        SOLVE_FIELD_PATH: ' /sf ',
        ASTROMETRY_DATA_DIR: '/idx',
        MAX_PARALLEL_SOLVES: ' 2 ',
      });
      expect(stored('ASTAP_PATH')).toBe('');
      expect(stored('SOLVE_FIELD_PATH')).toBe('/sf');
      expect(stored('ASTROMETRY_DATA_DIR')).toBe('/idx');
      expect(stored('MAX_PARALLEL_SOLVES')).toBe('2');
    });

    it('ignores a string setting that is not a string', async () => {
      await svc.update({ ASTAP_PATH: 5, SOLVE_FIELD_PATH: null, MAX_PARALLEL_SOLVES: true });
      expect(stored('ASTAP_PATH')).toBeUndefined();
      expect(stored('SOLVE_FIELD_PATH')).toBeUndefined();
      expect(stored('MAX_PARALLEL_SOLVES')).toBeUndefined();
    });

    it('writes the two switches as 1 or 0 only for a boolean', async () => {
      await svc.update({ USE_WSL_FOR_SOLVE_FIELD: true, USE_WSL_FOR_ASTAP: false });
      expect(stored('USE_WSL_FOR_SOLVE_FIELD')).toBe('1');
      expect(stored('USE_WSL_FOR_ASTAP')).toBe('0');
      await svc.update({ USE_WSL_FOR_SOLVE_FIELD: 'false', USE_WSL_FOR_ASTAP: 0 });
      expect(stored('USE_WSL_FOR_SOLVE_FIELD')).toBe('1');
      expect(stored('USE_WSL_FOR_ASTAP')).toBe('0');
    });

    it('ignores keys it does not know', async () => {
      await svc.update({ SOMETHING_ELSE: 'x' });
      expect(conn.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    });

    it.each([[{}], [undefined], [null]])(
      'accepts the body %j and changes nothing',
      async (body) => {
        expect(await svc.update(body)).toEqual({ apiKeyChanged: false });
        expect(conn.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
      },
    );

    it('writes everything of one call together or nothing', async () => {
      conn.exec(
        `CREATE TRIGGER fail_on_wsl BEFORE INSERT ON settings WHEN NEW.key = 'USE_WSL_FOR_ASTAP'
         BEGIN SELECT RAISE(ABORT, 'boom'); END`,
      );
      await expect(
        svc.update({ ASTAP_PATH: '/p', apiKey: 'k', USE_WSL_FOR_ASTAP: true }),
      ).rejects.toThrow('boom');
      expect(conn.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
    });
  });

  describe('onApiKeyChanged', () => {
    it('is called once when update writes a key, and not when it does not', async () => {
      await svc.update({ ASTAP_PATH: '/p' });
      await svc.update({ apiKey: '  ' });
      expect(keyChanges).toBe(0);
      await svc.update({ apiKey: 'k' });
      expect(keyChanges).toBe(1);
    });

    it('is not called when the environment locks the key', async () => {
      env.ASTROMETRY_API_KEY = 'env-key';
      await expect(svc.update({ apiKey: 'x' })).rejects.toThrow();
      await expect(svc.removeApiKey()).rejects.toThrow();
      expect(keyChanges).toBe(0);
    });

    it('is called when removeApiKey removes the key', async () => {
      await svc.removeApiKey();
      expect(keyChanges).toBe(1);
    });
  });

  describe('removeApiKey', () => {
    it('removes the stored key', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'k');
      await svc.removeApiKey();
      expect(stored('ASTROMETRY_API_KEY')).toBeUndefined();
      expect((await svc.readPublic()).apiKeySet).toBe(false);
    });

    it('succeeds when no key is stored', async () => {
      await expect(svc.removeApiKey()).resolves.toBeUndefined();
    });

    it('refuses when the environment defines the key, with the exact 409 body', async () => {
      await svc.set('ASTROMETRY_API_KEY', 'k');
      env.ASTROMETRY_API_KEY = 'env-key';
      const err = await rejection(svc.removeApiKey());
      expect(err.kind).toBe('conflict');
      expect(err.body).toEqual(LOCKED_BODY);
      expect(stored('ASTROMETRY_API_KEY')).toBe('k');
    });
  });
});

describe.each(SQL_ADAPTERS)('SettingsService round trips (%s)', (_adapter, wrap) => {
  let conn: Database.Database;
  let db: CountingSqlDb;
  beforeEach(async () => {
    conn = new Database(':memory:');
    db = countingSqlDb(wrap(createBetterSqliteDb(conn)));
    await initSchema(db);
    db.reset();
  });
  afterEach(() => conn.close());

  /** Round trips made by `fn`. */
  const trips = async (fn: () => Promise<unknown>): Promise<number> => {
    db.reset();
    await fn();
    return db.calls();
  };

  const make = (): SettingsService =>
    createSettingsService({
      db,
      secrets: fakeCodec({ enabled: false }),
      env: () => undefined,
      platform: { isWindows: false },
    });

  it('makes a fixed number of round trips per method', async () => {
    const svc = make();
    expect(await trips(() => svc.get('ASTAP_PATH'))).toBe(1);
    expect(await trips(() => svc.get('ASTROMETRY_API_KEY'))).toBe(1);
    expect(await trips(() => svc.set('ASTAP_PATH', '/x'))).toBe(1);
    expect(await trips(() => svc.remove('ASTAP_PATH'))).toBe(1);
    expect(await trips(() => svc.removeApiKey())).toBe(1);
  });

  it('reads every public setting in one query', async () => {
    const svc = make();
    expect(await trips(() => svc.readPublic())).toBe(1);
    await svc.update({ ASTAP_PATH: '/a', SOLVE_FIELD_PATH: '/b', USE_WSL_FOR_ASTAP: true });
    expect(await trips(() => svc.readPublic())).toBe(1);
  });

  it('writes all the changed settings of an update in one batch', async () => {
    const svc = make();
    expect(await trips(() => svc.update({}))).toBe(0);
    expect(await trips(() => svc.update({ ASTAP_PATH: '/a' }))).toBe(1);
    expect(
      await trips(() =>
        svc.update({
          apiKey: 'k',
          ASTAP_PATH: '/a',
          SOLVE_FIELD_PATH: '/b',
          ASTROMETRY_DATA_DIR: '/c',
          MAX_PARALLEL_SOLVES: '2',
          USE_WSL_FOR_SOLVE_FIELD: true,
          USE_WSL_FOR_ASTAP: false,
        }),
      ),
    ).toBe(1);
  });
});
