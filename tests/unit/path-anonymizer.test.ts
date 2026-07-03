import { describe, it, expect } from 'vitest';
import { buildPathAnonymizer } from '../../electron/path-anonymizer';

describe('buildPathAnonymizer', () => {
  describe('known-path replacement', () => {
    it('replaces an exact known path with its placeholder', () => {
      const anon = buildPathAnonymizer([['/home/alice/appdata', '<userData>']]);
      expect(anon('/home/alice/appdata/data.db')).toBe('<userData>/data.db');
    });

    it('replaces multiple known paths in order (most specific first)', () => {
      const anon = buildPathAnonymizer([
        ['/home/alice/appdata', '<userData>'],
        ['/home/alice', '<home>'],
      ]);
      // userData (/home/alice/appdata) must be replaced before home (/home/alice)
      // so the remaining /home/alice portion gets replaced too
      const result = anon('/home/alice/appdata/logs and /home/alice/photos');
      expect(result).toBe('<userData>/logs and <home>/photos');
    });

    it('replaces the same path multiple times in one string', () => {
      const anon = buildPathAnonymizer([['/fake/home', '<home>']]);
      expect(anon('/fake/home/a and /fake/home/b')).toBe('<home>/a and <home>/b');
    });

    it('ignores blank paths in the known-paths list', () => {
      const anon = buildPathAnonymizer([
        ['', '<nothing>'],
        ['/real/path', '<real>'],
      ]);
      expect(anon('/real/path/file')).toBe('<real>/file');
    });

    it('handles paths containing regex-special characters (spaces, dots)', () => {
      const anon = buildPathAnonymizer([['/Users/alice/My Documents/App Data', '<userData>']]);
      expect(anon('/Users/alice/My Documents/App Data/db.sqlite')).toBe('<userData>/db.sqlite');
    });
  });

  describe('case sensitivity', () => {
    it('is case-insensitive when caseInsensitive=true', () => {
      const anon = buildPathAnonymizer([['/Home/Alice', '<home>']], true);
      expect(anon('/home/alice/file.txt')).toBe('<home>/file.txt');
      expect(anon('/HOME/ALICE/file.txt')).toBe('<home>/file.txt');
    });

    it('is case-sensitive when caseInsensitive=false', () => {
      const anon = buildPathAnonymizer([['/Home/Alice', '<home>']], false);
      expect(anon('/Home/Alice/file.txt')).toBe('<home>/file.txt');
      // Different case is NOT replaced by the known-path rule
      // (may still be caught by the fallback regex depending on platform pattern)
      expect(anon('/home/alice/file.txt')).not.toBe('<home>/file.txt');
    });
  });

  describe('Windows fallback regex', () => {
    it('replaces C:\\Users\\<name> paths not matched by known paths', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('Error at C:\\Users\\bob\\AppData\\Roaming\\MyApp\\db.sqlite')).toBe(
        'Error at <user-path>',
      );
    });

    it('replaces different drive letters', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('D:\\Users\\carol\\documents')).toBe('<user-path>');
    });

    it('does not clobber text before the drive letter', () => {
      const anon = buildPathAnonymizer([]);
      const result = anon('stack: at C:\\Users\\dave\\app.js:10');
      expect(result).toContain('stack: at ');
      expect(result).not.toContain('dave');
    });

    it('is case-insensitive for Windows paths', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('c:\\users\\eve\\file.txt')).toBe('<user-path>');
    });
  });

  describe('Unix fallback regex', () => {
    it('replaces /home/<name> paths not matched by known paths', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('Error reading /home/frank/pictures/M42.fit')).toBe('Error reading <user-path>');
    });

    it('replaces multiple /home paths in a single string', () => {
      const anon = buildPathAnonymizer([]);
      const result = anon('/home/grace/a.fit and /home/grace/b.fit');
      expect(result).toBe('<user-path> and <user-path>');
    });

    it('does not replace paths that do not start with /home/', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('/var/log/syslog')).toBe('/var/log/syslog');
      expect(anon('/tmp/solver-output')).toBe('/tmp/solver-output');
    });
  });

  describe('combined: known paths shadow fallback regex', () => {
    it('known userData path is replaced before fallback fires', () => {
      const anon = buildPathAnonymizer([['/home/henry/appdata', '<userData>']]);
      // The known-path replacement handles /home/henry/appdata; the remaining
      // /home/henry prefix is then caught by the fallback.
      const result = anon('/home/henry/appdata/logs and /home/henry/photos');
      expect(result).not.toContain('henry');
      expect(result).toContain('<userData>');
    });
  });

  describe('passthrough for safe strings', () => {
    it('does not alter strings with no personal paths', () => {
      const anon = buildPathAnonymizer([['/home/user', '<home>']]);
      expect(anon('plate solve failed: no index files')).toBe('plate solve failed: no index files');
    });

    it('returns empty string unchanged', () => {
      const anon = buildPathAnonymizer([]);
      expect(anon('')).toBe('');
    });
  });
});
