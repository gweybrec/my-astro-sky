/** A signing keystore placed in the Android project is never committed. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const android = join(__dirname, '../android');

function ignored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: android });
    return true;
  } catch {
    return false;
  }
}

describe('Android keystores', () => {
  it.each(['release.jks', 'app/upload.keystore'])('%s is ignored by git', (path) => {
    expect(ignored(path)).toBe(true);
  });
});
