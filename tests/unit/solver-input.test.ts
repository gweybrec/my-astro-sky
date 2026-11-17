import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { placeSolverInput } from '../../server/solver-input';

describe('placeSolverInput()', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-input-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('moves the upload into place', async () => {
    const src = path.join(dir, 'a.part');
    const dest = path.join(dir, 'input.fits');
    fs.writeFileSync(src, 'stack');
    await placeSolverInput(src, dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('stack');
    expect(fs.existsSync(src)).toBe(false);
  });

  it('copies it when the folders are on different disks', async () => {
    const src = path.join(dir, 'a.part');
    const dest = path.join(dir, 'input.fits');
    fs.writeFileSync(src, 'stack');
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('cross-device link'), { code: 'EXDEV' }),
    );
    await placeSolverInput(src, dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('stack');
  });

  it('passes any other failure on', async () => {
    await expect(
      placeSolverInput(path.join(dir, 'missing.part'), path.join(dir, 'x')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
