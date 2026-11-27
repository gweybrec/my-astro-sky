import { describe, it, expect } from 'vitest';
import { createErrorLog, RECORDS_PER_FILE, type ErrorLogFilesystem } from '../src/error-log';

/** An in-memory stand-in for Capacitor's Filesystem plugin. */
function memoryFs(): ErrorLogFilesystem & { files: Map<string, string>; failNext?: boolean } {
  const files = new Map<string, string>();
  const fs = {
    files,
    failNext: false,
    async appendFile({ path, data }: { path: string; data: string }) {
      if (fs.failNext) {
        fs.failNext = false;
        throw new Error('disk full');
      }
      files.set(path, (files.get(path) ?? '') + data);
    },
    async readFile({ path }: { path: string }) {
      const data = files.get(path);
      if (data === undefined) throw new Error('File does not exist');
      return { data };
    },
    async rename({ from, to }: { from: string; to: string }) {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    async deleteFile({ path }: { path: string }) {
      if (!files.delete(path)) throw new Error('File does not exist');
    },
    async mkdir() {},
  };
  return fs;
}

const ticket = (ref: string) => ({ code: 'INTERNAL_ERROR' as const, ref });

function make(fs = memoryFs()) {
  const log = createErrorLog({
    fs,
    directory: 'DATA',
    version: '1.2.3',
    platform: 'android',
    now: () => new Date('2026-01-02T03:04:05Z'),
    secrets: () => ['my-astrometry-key'],
  });
  return { fs, log };
}

describe('the phone error log', () => {
  it('writes one JSON line per error, with the code and reference shown to the user', async () => {
    const { log } = make();
    await log.record('photo_save', new Error('boom'), { photoId: 'p1' }, ticket('AB12'));
    const [line] = (await log.read()).trim().split('\n');
    expect(JSON.parse(line)).toMatchObject({
      timestamp: '2026-01-02T03:04:05.000Z',
      appVersion: '1.2.3',
      platform: 'android',
      category: 'photo_save',
      code: 'INTERNAL_ERROR',
      ref: 'AB12',
      message: 'boom',
      context: { photoId: 'p1' },
    });
  });

  it('removes the astrometry.net key from the message, the stack and the details', async () => {
    const { log } = make();
    const err = new Error('login failed for my-astrometry-key');
    await log.record('login', err, { body: '{"apikey":"other-key"}' }, ticket('K1'));
    const text = await log.read();
    expect(text).not.toContain('my-astrometry-key');
    expect(text).not.toContain('other-key');
  });

  it('keeps only the last two files of records', async () => {
    const { log } = make();
    const total = RECORDS_PER_FILE * 2 + 10;
    for (let i = 0; i < total; i++)
      void log.record('c', new Error(`e${i}`), undefined, ticket('R'));
    const lines = (await log.read()).trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(RECORDS_PER_FILE * 2);
    expect(JSON.parse(lines[lines.length - 1]).message).toBe(`e${total - 1}`);
    expect(JSON.parse(lines[0]).message).not.toBe('e0');
  });

  it('carries on after a failed write, and reads empty before any error', async () => {
    const { fs, log } = make();
    expect(await log.read()).toBe('');
    fs.failNext = true;
    await expect(
      log.record('c', new Error('lost'), undefined, ticket('A')),
    ).resolves.toBeUndefined();
    await log.record('c', new Error('kept'), undefined, ticket('B'));
    expect(await log.read()).toContain('"kept"');
  });

  it('counts the records already on disk when the app starts again', async () => {
    const fs = memoryFs();
    fs.files.set('logs/errors.jsonl', '{"message":"old"}\n'.repeat(RECORDS_PER_FILE));
    const { log } = make(fs);
    await log.record('c', new Error('new'), undefined, ticket('N'));
    expect(fs.files.get('logs/errors.1.jsonl')).toContain('old');
    expect(fs.files.get('logs/errors.jsonl')).toContain('"new"');
  });

  it('keeps no file name, path or position of the user', async () => {
    const { log } = make();
    await log.record(
      'import',
      new Error('Cannot read /storage/emulated/0/DCIM/M42 final.jpg'),
      { detail: 'Refused file name: Orion.fits' },
      ticket('F1'),
    );
    const text = await log.read();
    expect(text).not.toMatch(/storage|DCIM|M42|Orion/);
    expect(text).toContain('[path]');
    expect(text).toContain('[file]');
  });

  it('records what lies under the error, cleaned', async () => {
    const { log } = make();
    const cause = new Error("ENOENT: open '/storage/emulated/0/DCIM/M42.jpg'");
    await log.record('import', new Error('Import failed', { cause }), undefined, ticket('C1'));
    const line = JSON.parse((await log.read()).trim());
    expect(line.causes).toEqual(["Error: ENOENT: open '[file]'"]);
  });
});
