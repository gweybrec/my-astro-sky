import { describe, it, expect } from 'vitest';
import { sanitizeContext, MAX_SANITIZE_VALUE_LENGTH, MAX_SANITIZE_DEPTH } from '../../electron/sanitize-context';

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
      const result = sanitizeContext({ Password: 'secret', TOKEN: 'xyz' }) as Record<string, unknown>;
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
