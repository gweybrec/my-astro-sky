import { describe, it, expect } from 'vitest';
import {
  sanitizeContext,
  MAX_SANITIZE_VALUE_LENGTH,
  MAX_SANITIZE_DEPTH,
  removeUserData,
} from '@myastrosky/core/platform/log-sanitize';

describe('sanitizeContext', () => {
  describe('primitive passthrough', () => {
    it('returns null for null', () => {
      expect(sanitizeContext(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(sanitizeContext(undefined)).toBeNull();
    });

    it('passes numbers through unchanged', () => {
      expect(sanitizeContext(42)).toBe(42);
      expect(sanitizeContext(-3.14)).toBe(-3.14);
    });

    it('passes booleans through unchanged', () => {
      expect(sanitizeContext(true)).toBe(true);
      expect(sanitizeContext(false)).toBe(false);
    });
  });

  describe('string handling', () => {
    it('returns a plain string unchanged', () => {
      expect(sanitizeContext('hello world')).toBe('hello world');
    });

    it('redacts astrometry apikey from strings', () => {
      const result = sanitizeContext('{"apikey":"topsecret","other":1}') as string;
      expect(result).not.toContain('topsecret');
      expect(result).toContain('[redacted]');
    });

    it('applies custom anonymize function to strings', () => {
      const anon = (s: string) => s.replace('/home/user', '<home>');
      expect(sanitizeContext('/home/user/data.db', anon)).toBe('<home>/data.db');
    });

    it('truncates strings longer than MAX_SANITIZE_VALUE_LENGTH', () => {
      const long = 'x'.repeat(MAX_SANITIZE_VALUE_LENGTH + 100);
      const result = sanitizeContext(long) as string;
      expect(result.length).toBeLessThanOrEqual(MAX_SANITIZE_VALUE_LENGTH + 20);
      expect(result).toContain('…[truncated]');
    });

    it('does not truncate strings exactly at the limit', () => {
      const exact = 'y'.repeat(MAX_SANITIZE_VALUE_LENGTH);
      const result = sanitizeContext(exact) as string;
      expect(result).toBe(exact);
    });
  });

  describe('secret key redaction in objects', () => {
    it('redacts "password" key', () => {
      const result = sanitizeContext({ password: 'hunter2' }) as Record<string, unknown>;
      expect(result.password).toBe('[redacted]');
    });

    it('redacts "token" key', () => {
      const result = sanitizeContext({ token: 'abc123' }) as Record<string, unknown>;
      expect(result.token).toBe('[redacted]');
    });

    it('redacts "apikey" and "api_key" variants', () => {
      const r1 = sanitizeContext({ apikey: 'k1' }) as Record<string, unknown>;
      const r2 = sanitizeContext({ api_key: 'k2' }) as Record<string, unknown>;
      const r3 = sanitizeContext({ 'api-key': 'k3' }) as Record<string, unknown>;
      expect(r1.apikey).toBe('[redacted]');
      expect(r2.api_key).toBe('[redacted]');
      expect(r3['api-key']).toBe('[redacted]');
    });

    it('redacts "secret", "session", "jwt", "authorization", "cookie" keys', () => {
      const obj = { secret: 'x', session: 'y', jwt: 'z', authorization: 'a', cookie: 'b' };
      const result = sanitizeContext(obj) as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        expect(result[key]).toBe('[redacted]');
      }
    });

    it('does not redact non-sensitive keys', () => {
      const result = sanitizeContext({ category: 'error', count: 3 }) as Record<string, unknown>;
      expect(result.category).toBe('error');
      expect(result.count).toBe(3);
    });

    it('is case-insensitive for key matching', () => {
      const result = sanitizeContext({ Password: 'secret', TOKEN: 'xyz' }) as Record<
        string,
        unknown
      >;
      expect(result.Password).toBe('[redacted]');
      expect(result.TOKEN).toBe('[redacted]');
    });
  });

  describe('Error objects', () => {
    it('serializes Error to { name, message, stack }', () => {
      const err = new Error('something went wrong');
      const result = sanitizeContext(err) as Record<string, unknown>;
      expect(result.name).toBe('Error');
      expect(result.message).toBe('something went wrong');
      expect(typeof result.stack).toBe('string');
    });

    it('applies anonymize to Error message and stack', () => {
      const anon = (s: string) => s.replace(/\/home\/user/g, '<home>');
      const err = new Error('/home/user/solver failed');
      err.stack = 'Error: /home/user/solver failed\n  at fn (/home/user/app.js:1:1)';
      const result = sanitizeContext(err, anon) as Record<string, unknown>;
      expect(result.message as string).not.toContain('/home/user');
      expect(result.stack as string).not.toContain('/home/user');
    });

    it('handles Error with no stack', () => {
      const err = new Error('bare');
      Object.defineProperty(err, 'stack', { value: undefined });
      const result = sanitizeContext(err) as Record<string, unknown>;
      expect(result.stack).toBeNull();
    });
  });

  describe('arrays', () => {
    it('recursively sanitizes array items', () => {
      const result = sanitizeContext([{ password: 'x' }, 'plain', 42]) as unknown[];
      expect((result[0] as Record<string, unknown>).password).toBe('[redacted]');
      expect(result[1]).toBe('plain');
      expect(result[2]).toBe(42);
    });
  });

  describe('nested objects', () => {
    it('recursively sanitizes nested values', () => {
      const obj = { outer: { inner: { password: 'secret' } } };
      const result = sanitizeContext(obj) as Record<string, unknown>;
      const inner = (result.outer as Record<string, unknown>).inner as Record<string, unknown>;
      expect(inner.password).toBe('[redacted]');
    });

    it('applies anonymize recursively to nested strings', () => {
      const anon = (s: string) => s.replace('PRIVATE', '<redacted>');
      const obj = { details: { file: 'PRIVATE/path' } };
      const result = sanitizeContext(obj, anon) as Record<string, unknown>;
      const details = result.details as Record<string, unknown>;
      expect(details.file).toBe('<redacted>/path');
    });
  });

  describe('depth limiting', () => {
    it(`stops recursing at depth ${MAX_SANITIZE_DEPTH} and returns '[max-depth-reached]'`, () => {
      // Build an object nested MAX_SANITIZE_DEPTH + 1 levels deep
      let nested: Record<string, unknown> = { leaf: 'value' };
      for (let i = 0; i < MAX_SANITIZE_DEPTH; i++) {
        nested = { child: nested };
      }
      const result = sanitizeContext(nested) as Record<string, unknown>;
      // Walk down MAX_SANITIZE_DEPTH levels — the deepest accessible node should be the sentinel
      let cursor: unknown = result;
      for (let i = 0; i < MAX_SANITIZE_DEPTH; i++) {
        cursor = (cursor as Record<string, unknown>).child;
      }
      expect(cursor).toBe('[max-depth-reached]');
    });
  });

  describe('non-serializable values', () => {
    it('converts a Symbol to its string representation', () => {
      const result = sanitizeContext(Symbol('debug')) as string;
      expect(typeof result).toBe('string');
      expect(result).toContain('Symbol');
    });

    it('converts a function to its string representation', () => {
      const result = sanitizeContext(() => {}) as string;
      expect(typeof result).toBe('string');
    });
  });
});

describe('removeUserData', () => {
  it('removes absolute paths of the machine and the phone', () => {
    expect(removeUserData(String.raw`ENOENT: open 'D:\Astro\2025\M31\stack.fits'`)).toBe(
      "ENOENT: open '[file]'",
    );
    expect(removeUserData(String.raw`EPERM: 'D:\My Photos\M31 final.fits'`)).toBe(
      "EPERM: '[file]'",
    );
    expect(removeUserData(String.raw`scan D:\Astro\2025 done`)).toBe('scan [path] done');
    expect(removeUserData(String.raw`at /home/alice/astro/x on \\nas\photos\m42`)).toBe(
      'at [path] on [path]',
    );
    expect(removeUserData('read content://media/external/images/1234 failed')).toBe(
      'read [path] failed',
    );
    expect(removeUserData('cannot open /storage/emulated/0/DCIM/M42.jpg')).toBe(
      'cannot open [path]',
    );
  });

  it("removes the names of the user's files", () => {
    expect(removeUserData(`Could not read 'Orion nebula final.TIF' (bad header)`)).toBe(
      "Could not read '[file]' (bad header)",
    );
    expect(removeUserData('M31_LRGB_2025-10-03.xisf is not supported')).toBe(
      '[file] is not supported',
    );
    expect(removeUserData('import of ciel de Paul.myastrosky failed')).toBe(
      'import of ciel de Paul.myastrosky failed'.replace('Paul.myastrosky', '[file]'),
    );
  });

  it('keeps the code locations of a stack trace and the paths already anonymised', () => {
    const stack =
      'TypeError: x\n    at save (http://localhost:5173/src/toast.ts:12:3)\n    at <app>/dist/index.js:4:1';
    expect(removeUserData(stack)).toBe(stack);
    expect(removeUserData('<home>/data.db')).toBe('<home>/data.db');
  });

  it("keeps only the host of an outside server, and the app's own addresses whole", () => {
    expect(
      removeUserData(
        'GET https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?RA=10.68&DEC=41.27&EPOCH=2460000.5 failed',
      ),
    ).toBe('GET https://ssp.imcce.fr/… failed');
    expect(
      removeUserData(
        'tile https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2100/1400.png',
      ),
    ).toBe('tile https://s3.amazonaws.com/…');
    expect(removeUserData('at https://localhost/assets/index-a1b2.js:3:9')).toBe(
      'at https://localhost/assets/index-a1b2.js:3:9',
    );
  });

  it('drops the excerpt a JSON parse error quotes', () => {
    expect(removeUserData(`Unexpected token 'M', "My notes on M31" is not valid JSON`)).toBe(
      `Unexpected token 'M', "…" is not valid JSON`,
    );
  });

  it('is applied to every string of a context', () => {
    expect(sanitizeContext({ detail: String.raw`open E:\photos\m1.fits` })).toEqual({
      detail: 'open [path]',
    });
  });
});
