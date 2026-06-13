import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isUpdateAvailable } from '../../src/version-check';

describe('parseVersion', () => {
  it('parses a plain semver string', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('strips a leading v (GitHub tag form)', () => {
    expect(parseVersion('v0.2.0')).toEqual([0, 2, 0]);
    expect(parseVersion('V1.0.0')).toEqual([1, 0, 0]);
  });

  it('ignores pre-release and build metadata suffixes', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3+build.7')).toEqual([1, 2, 3]);
  });

  it('tolerates fewer than three segments', () => {
    expect(parseVersion('2')).toEqual([2]);
    expect(parseVersion('2.1')).toEqual([2, 1]);
  });

  it('returns null for unparseable input', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('v')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    // @ts-expect-error testing non-string guard
    expect(parseVersion(null)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders equal versions as 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('compares numerically, not lexically', () => {
    // 0.10.0 must be greater than 0.9.0
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
  });

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });
});

describe('isUpdateAvailable', () => {
  it('is true when latest is strictly newer', () => {
    expect(isUpdateAvailable('0.1.0', '0.2.0')).toBe(true);
    expect(isUpdateAvailable('0.1.0', 'v0.1.1')).toBe(true);
    expect(isUpdateAvailable('0.9.0', '0.10.0')).toBe(true);
  });

  it('is false when current is equal or newer', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false);
    expect(isUpdateAvailable('2.0.0', '1.9.9')).toBe(false);
  });

  it('is false when either version is unparseable', () => {
    expect(isUpdateAvailable('', '1.0.0')).toBe(false);
    expect(isUpdateAvailable('1.0.0', '')).toBe(false);
    expect(isUpdateAvailable('1.0.0', 'latest')).toBe(false);
  });
});
