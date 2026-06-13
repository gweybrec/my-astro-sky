import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { cleanupOldLogsSafely } from '../../electron/log-retention';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function canCreateSymlinks(): boolean {
  const tempDir = makeTempDir('mas-symlink-test-');
  const targetFile = path.join(tempDir, 'target.txt');
  const linkPath = path.join(tempDir, 'link.txt');
  try {
    fs.writeFileSync(targetFile, 'x');
    fs.symlinkSync(targetFile, linkPath, 'file');
    fs.unlinkSync(linkPath);
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

const symlinkTest = canCreateSymlinks() ? it : it.skip;

function writeFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
  fs.writeFileSync(filePath, content, 'utf8');
  const atime = new Date(mtimeMs);
  const mtime = new Date(mtimeMs);
  fs.utimesSync(filePath, atime, mtime);
}

describe('cleanupOldLogsSafely', () => {
  it('deletes only old my-astro-sky-error files and keeps generic/legacy names', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const logsDir = path.join(userData, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const now = Date.now();
    const oldMs = now - 45 * 24 * 60 * 60 * 1000;
    const recentMs = now - 2 * 24 * 60 * 60 * 1000;

    const oldManagedLog = path.join(logsDir, 'my-astro-sky-error-20260101-010203-123-a1b2c3.json');
    const recentManagedLog = path.join(logsDir, 'my-astro-sky-error-20260101-010203-124-d4e5f6.json');
    const oldGenericLog = path.join(logsDir, 'error-legacy.json');
    const oldOther = path.join(logsDir, 'notes-old.txt');

    writeFileWithMtime(oldManagedLog, '{}', oldMs);
    writeFileWithMtime(recentManagedLog, '{}', recentMs);
    writeFileWithMtime(oldGenericLog, '{}', oldMs);
    writeFileWithMtime(oldOther, 'keep me', oldMs);

    const result = cleanupOldLogsSafely(userData, logsDir, now, 30);

    expect(result.skippedReason).toBeUndefined();
    expect(result.deletedCount).toBe(1);
    expect(fs.existsSync(oldManagedLog)).toBe(false);
    expect(fs.existsSync(recentManagedLog)).toBe(true);
    expect(fs.existsSync(oldGenericLog)).toBe(true);
    expect(fs.existsSync(oldOther)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('deletes old .jsonl batch files and keeps recent ones', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const logsDir = path.join(userData, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const now = Date.now();
    const oldMs = now - 45 * 24 * 60 * 60 * 1000;
    const recentMs = now - 2 * 24 * 60 * 60 * 1000;

    const oldBatch = path.join(logsDir, 'my-astro-sky-errors-20260101-010203-123.jsonl');
    const recentBatch = path.join(logsDir, 'my-astro-sky-errors-20260601-010203-456.jsonl');
    const unrelated = path.join(logsDir, 'other-file.jsonl');

    writeFileWithMtime(oldBatch, '{"timestamp":"2026-01-01"}\n', oldMs);
    writeFileWithMtime(recentBatch, '{"timestamp":"2026-06-01"}\n', recentMs);
    writeFileWithMtime(unrelated, '{"timestamp":"2026-01-01"}\n', oldMs);

    const result = cleanupOldLogsSafely(userData, logsDir, now, 30);

    expect(result.skippedReason).toBeUndefined();
    expect(result.deletedCount).toBe(1);
    expect(fs.existsSync(oldBatch)).toBe(false);
    expect(fs.existsSync(recentBatch)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('deletes old crash .jsonl files and keeps recent ones', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const logsDir = path.join(userData, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const now = Date.now();
    const oldMs = now - 45 * 24 * 60 * 60 * 1000;
    const recentMs = now - 2 * 24 * 60 * 60 * 1000;

    const oldCrash = path.join(logsDir, 'my-astro-sky-crash-20260101-010203-123.jsonl');
    const recentCrash = path.join(logsDir, 'my-astro-sky-crash-20260601-010203-456.jsonl');

    writeFileWithMtime(oldCrash, '{"timestamp":"2026-01-01"}\n', oldMs);
    writeFileWithMtime(recentCrash, '{"timestamp":"2026-06-01"}\n', recentMs);

    const result = cleanupOldLogsSafely(userData, logsDir, now, 30);

    expect(result.skippedReason).toBeUndefined();
    expect(result.deletedCount).toBe(1);
    expect(fs.existsSync(oldCrash)).toBe(false);
    expect(fs.existsSync(recentCrash)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('skips cleanup when logs directory is outside userData', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const outside = path.join(root, 'outside-logs');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const oldLog = path.join(outside, 'my-astro-sky-error-20260101-010203-123-a1b2c3.json');
    writeFileWithMtime(oldLog, '{}', Date.now() - 45 * 24 * 60 * 60 * 1000);

    const result = cleanupOldLogsSafely(userData, outside, Date.now(), 30);

    expect(result.deletedCount).toBe(0);
    expect(result.skippedReason).toBe('logs_dir_outside_userdata');
    expect(fs.existsSync(oldLog)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  symlinkTest('skips cleanup when logs directory is a symlink', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const realLogs = path.join(root, 'real-logs');
    const logsLink = path.join(userData, 'logs');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(realLogs, { recursive: true });

    const oldLog = path.join(realLogs, 'my-astro-sky-error-20260101-010203-123-a1b2c3.json');
    writeFileWithMtime(oldLog, '{}', Date.now() - 45 * 24 * 60 * 60 * 1000);

    fs.symlinkSync(realLogs, logsLink, 'dir');

    const result = cleanupOldLogsSafely(userData, logsLink, Date.now(), 30);

    expect(result.deletedCount).toBe(0);
    expect(result.skippedReason).toBe('logs_dir_is_symlink');
    expect(fs.existsSync(oldLog)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  symlinkTest('never follows symlinked entries inside logs directory', () => {
    const root = makeTempDir('mas-retention-');
    const userData = path.join(root, 'userData');
    const logsDir = path.join(userData, 'logs');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const externalLog = path.join(outside, 'my-astro-sky-error-20260101-010203-123-a1b2c3.json');
    writeFileWithMtime(externalLog, '{}', Date.now() - 45 * 24 * 60 * 60 * 1000);

    const linkInLogs = path.join(logsDir, 'my-astro-sky-error-20260101-010203-124-d4e5f6.json');
    fs.symlinkSync(externalLog, linkInLogs, 'file');

    const result = cleanupOldLogsSafely(userData, logsDir, Date.now(), 30);

    expect(result.skippedReason).toBeUndefined();
    expect(result.deletedCount).toBe(0);
    expect(fs.existsSync(externalLog)).toBe(true);
    expect(fs.existsSync(linkInLogs)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
