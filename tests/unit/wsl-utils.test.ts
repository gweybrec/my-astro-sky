import { describe, it, expect } from 'vitest';
import { isTruthySetting, toWSLPath, wslPath, wrapExecForWSL } from '../../server/wsl-utils';

describe('wsl-utils', () => {
  describe('isTruthySetting', () => {
    it('accepts common truthy values', () => {
      expect(isTruthySetting('1')).toBe(true);
      expect(isTruthySetting('true')).toBe(true);
      expect(isTruthySetting('yes')).toBe(true);
      expect(isTruthySetting('on')).toBe(true);
      expect(isTruthySetting(' TRUE ')).toBe(true);
    });

    it('rejects falsy values', () => {
      expect(isTruthySetting(undefined)).toBe(false);
      expect(isTruthySetting('')).toBe(false);
      expect(isTruthySetting('0')).toBe(false);
      expect(isTruthySetting('false')).toBe(false);
      expect(isTruthySetting('off')).toBe(false);
    });
  });

  describe('toWSLPath', () => {
    it('converts Windows backslash paths', () => {
      expect(toWSLPath('C:\\Users\\alice\\image.jpg')).toBe('/mnt/c/Users/alice/image.jpg');
    });

    it('converts Windows slash paths', () => {
      expect(toWSLPath('D:/data/astro/input.fit')).toBe('/mnt/d/data/astro/input.fit');
    });

    it('keeps non-Windows paths unchanged', () => {
      expect(toWSLPath('/tmp/input.fit')).toBe('/tmp/input.fit');
      expect(toWSLPath('solve-field')).toBe('solve-field');
    });
  });

  describe('wslPath', () => {
    it('converts path only when WSL mode is on', () => {
      expect(wslPath('C:\\tmp\\a.fit', true)).toBe('/mnt/c/tmp/a.fit');
      expect(wslPath('C:\\tmp\\a.fit', false)).toBe('C:\\tmp\\a.fit');
    });
  });

  describe('wrapExecForWSL', () => {
    it('keeps native execution when WSL mode is off', () => {
      expect(wrapExecForWSL('solve-field', ['input.fit'], false)).toEqual({
        cmd: 'solve-field',
        args: ['input.fit'],
      });
    });

    it('wraps execution with wsl when WSL mode is on', () => {
      expect(wrapExecForWSL('solve-field', ['input.fit', '--no-plots'], true)).toEqual({
        cmd: 'wsl',
        args: ['solve-field', 'input.fit', '--no-plots'],
      });
    });
  });
});
