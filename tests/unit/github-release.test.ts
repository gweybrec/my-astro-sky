import { describe, it, expect } from 'vitest';
import { parseLatestRelease } from '../../server/github-release';

describe('parseLatestRelease', () => {
  it('maps a full GitHub release payload', () => {
    const payload = {
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/gweybrec/my-astro-sky/releases/tag/v0.2.0',
      published_at: '2026-06-10T12:00:00Z',
      // extra fields GitHub returns but we ignore
      id: 123,
      draft: false,
    };
    expect(parseLatestRelease(payload)).toEqual({
      version: 'v0.2.0',
      url: 'https://github.com/gweybrec/my-astro-sky/releases/tag/v0.2.0',
      publishedAt: '2026-06-10T12:00:00Z',
    });
  });

  it('defaults a missing url to empty string and missing published_at to null', () => {
    expect(parseLatestRelease({ tag_name: 'v1.0.0' })).toEqual({
      version: 'v1.0.0',
      url: '',
      publishedAt: null,
    });
  });

  it('returns null when there is no tag_name (repo has no releases)', () => {
    // GitHub returns a 404 body like { message: 'Not Found' } when there are no releases.
    expect(parseLatestRelease({ message: 'Not Found' })).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
  });

  it('returns null for an empty or non-string tag_name', () => {
    expect(parseLatestRelease({ tag_name: '' })).toBeNull();
    expect(parseLatestRelease({ tag_name: '   ' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 123 })).toBeNull();
  });

  it('returns null for non-object input (malformed/empty response)', () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease(undefined)).toBeNull();
    expect(parseLatestRelease('not json')).toBeNull();
    expect(parseLatestRelease(42)).toBeNull();
  });

  it('coerces non-string url/published_at fields to safe defaults', () => {
    expect(parseLatestRelease({ tag_name: 'v2.0.0', html_url: 99, published_at: false })).toEqual({
      version: 'v2.0.0',
      url: '',
      publishedAt: null,
    });
  });
});
