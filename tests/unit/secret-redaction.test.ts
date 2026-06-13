import { describe, expect, it, vi, afterEach } from 'vitest';
import { redactSecrets } from '../../electron/secret-redaction';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('redactSecrets', () => {
  it('redacts astrometry apikey in JSON snippets', () => {
    const input = '{"apikey":"my-secret-key","other":1}';
    const out = redactSecrets(input);
    expect(out).toContain('"apikey":"[redacted]"');
    expect(out).not.toContain('my-secret-key');
  });

  it('redacts apikey in form payload snippets', () => {
    const input = 'request-json=%7B%22apikey%22%3A%22abc123%22%7D&apikey=abc123';
    const out = redactSecrets(input);
    expect(out).toContain('apikey=[redacted]');
    expect(out).not.toContain('abc123');
  });

  it('redacts ASTROMETRY_API_KEY assignment snippets', () => {
    const input = 'ASTROMETRY_API_KEY = topsecret';
    const out = redactSecrets(input);
    expect(out).toContain('ASTROMETRY_API_KEY = [redacted]');
    expect(out).not.toContain('topsecret');
  });

  it('redacts configured env key value when present in free text', () => {
    vi.stubEnv('ASTROMETRY_API_KEY', 'env-secret');
    const out = redactSecrets('failed with token env-secret in payload');
    expect(out).not.toContain('env-secret');
    expect(out).toContain('[redacted]');
  });
});
