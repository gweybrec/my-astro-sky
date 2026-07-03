import { describe, it, expect, vi } from 'vitest';
import { probeAstap, probeSolveField, probeDataDir } from '../../server/probe-utils';
import type { ExecAsync } from '../../server/probe-utils';

// ─── probeAstap ───────────────────────────────────────────────────────────────

describe('probeAstap', () => {
  it('returns ok with first 2 lines of output on rc=0', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({
      stdout:
        'ASTAP astrometric solver version CLI-2026.02.09\n(C) 2018, 2025 by Han Kleijn.\nExtra line that should be discarded.\n',
      stderr: '',
    });
    const result = await probeAstap('/opt/astap/astap_cli', false, exec);
    expect(result).toEqual({
      ok: true,
      output: 'ASTAP astrometric solver version CLI-2026.02.09\n(C) 2018, 2025 by Han Kleijn.',
    });
  });

  it('handles output with exactly 1 line gracefully', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: 'ASTAP v1\n', stderr: '' });
    const result = await probeAstap('/opt/astap/astap_cli', false, exec);
    expect(result).toMatchObject({ ok: true, output: 'ASTAP v1' });
  });

  it('calls exec with the bare path and no args (non-WSL)', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: 'ASTAP v1', stderr: '' });
    await probeAstap('/usr/bin/astap_cli', false, exec);
    expect(exec).toHaveBeenCalledWith('/usr/bin/astap_cli', [], { timeout: 5_000 });
  });

  it('wraps the command with wsl when useWSL=true', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: 'ASTAP v1', stderr: '' });
    await probeAstap('/opt/astap/astap_cli', true, exec);
    expect(exec).toHaveBeenCalledWith('wsl', ['/opt/astap/astap_cli'], { timeout: 5_000 });
  });

  it('returns error with code and output when exec rejects (rc!=0)', async () => {
    const err = Object.assign(new Error('process exited with code 1'), {
      code: 1,
      stdout: '',
      stderr: 'Segmentation fault',
    });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeAstap('/opt/astap/astap_cli', false, exec);
    expect(result).toEqual({ ok: false, code: 1, stdout: '', stderr: 'Segmentation fault' });
  });

  it('returns code=-1 on ENOENT', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeAstap('/missing/astap_cli', false, exec);
    expect(result).toMatchObject({ ok: false, code: -1 });
  });

  it('returns error without calling exec when path is empty', async () => {
    const exec = vi.fn<ExecAsync>();
    const result = await probeAstap('', false, exec);
    expect(result).toEqual({ ok: false, code: -1, stdout: '', stderr: '' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns error without calling exec when path is whitespace only', async () => {
    const exec = vi.fn<ExecAsync>();
    const result = await probeAstap('   ', false, exec);
    expect(result.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});

// ─── probeSolveField ──────────────────────────────────────────────────────────

describe('probeSolveField', () => {
  it('returns ok with version on rc=0', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: '0.89\n', stderr: '' });
    const result = await probeSolveField('/usr/bin/solve-field', false, exec);
    expect(result).toEqual({ ok: true, version: '0.89' });
  });

  it('calls exec with --version arg (non-WSL)', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: '0.89', stderr: '' });
    await probeSolveField('/usr/bin/solve-field', false, exec);
    expect(exec).toHaveBeenCalledWith('/usr/bin/solve-field', ['--version'], { timeout: 5_000 });
  });

  it('wraps the command with wsl when useWSL=true', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: '0.89', stderr: '' });
    await probeSolveField('/usr/bin/solve-field', true, exec);
    expect(exec).toHaveBeenCalledWith('wsl', ['/usr/bin/solve-field', '--version'], {
      timeout: 5_000,
    });
  });

  it('returns error when exec rejects (binary not found)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeSolveField('/usr/bin/solve-field', false, exec);
    expect(result).toMatchObject({ ok: false, code: -1 });
  });

  it('returns error with stdout/stderr when rc!=0', async () => {
    const err = Object.assign(new Error('exited 1'), {
      code: 1,
      stdout: 'usage: solve-field ...',
      stderr: 'error: bad arg',
    });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeSolveField('/usr/bin/solve-field', false, exec);
    expect(result).toEqual({
      ok: false,
      code: 1,
      stdout: 'usage: solve-field ...',
      stderr: 'error: bad arg',
    });
  });

  it('returns error without calling exec when path is empty', async () => {
    const exec = vi.fn<ExecAsync>();
    const result = await probeSolveField('', false, exec);
    expect(result.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});

// ─── probeDataDir ─────────────────────────────────────────────────────────────

describe('probeDataDir', () => {
  it('calls ls -1 on Linux (non-WSL)', async () => {
    const exec = vi
      .fn<ExecAsync>()
      .mockResolvedValue({ stdout: 'index-4200.fits\nindex-4201.fits\n', stderr: '' });
    const result = await probeDataDir('/var/lib/astrometry/data', false, 'linux', exec);
    expect(exec).toHaveBeenCalledWith('ls', ['-1', '/var/lib/astrometry/data'], { timeout: 5_000 });
    expect(result).toEqual({ ok: true, output: 'index-4200.fits\nindex-4201.fits\n' });
  });

  it('calls cmd /c dir /b on Windows (non-WSL)', async () => {
    const exec = vi
      .fn<ExecAsync>()
      .mockResolvedValue({ stdout: 'index-4200.fits\nindex-4201.fits\n', stderr: '' });
    const result = await probeDataDir('C:\\astro', false, 'win32', exec);
    expect(exec).toHaveBeenCalledWith('cmd', ['/c', 'dir', '/b', 'C:\\astro'], { timeout: 5_000 });
    expect(result).toEqual({ ok: true, output: 'index-4200.fits\nindex-4201.fits\n' });
  });

  it('calls wsl ls -1 on Windows with useWSL=true', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: 'index-4200.fits\n', stderr: '' });
    const result = await probeDataDir('/mnt/d/astro', true, 'win32', exec);
    expect(exec).toHaveBeenCalledWith('wsl', ['ls', '-1', '/mnt/d/astro'], { timeout: 5_000 });
    expect(result).toEqual({ ok: true, output: 'index-4200.fits\n' });
  });

  it('calls wsl ls -1 when useWSL=true regardless of platform', async () => {
    const exec = vi.fn<ExecAsync>().mockResolvedValue({ stdout: 'index-4200.fits\n', stderr: '' });
    await probeDataDir('/some/dir', true, 'linux', exec);
    expect(exec).toHaveBeenCalledWith('wsl', ['ls', '-1', '/some/dir'], { timeout: 5_000 });
  });

  it('returns error with combined output on rc!=0', async () => {
    const err = Object.assign(new Error('ls failed'), {
      code: 1,
      stdout: '',
      stderr: 'ls: /missing: No such file or directory',
    });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeDataDir('/missing', false, 'linux', exec);
    expect(result).toMatchObject({ ok: false, code: 1 });
    expect((result as any).output).toContain('No such file or directory');
  });

  it('returns error with code=-1 on ENOENT', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const exec = vi.fn<ExecAsync>().mockRejectedValue(err);
    const result = await probeDataDir('/some/dir', false, 'linux', exec);
    expect(result).toMatchObject({ ok: false, code: -1 });
  });

  it('returns error without calling exec when dir is empty', async () => {
    const exec = vi.fn<ExecAsync>();
    const result = await probeDataDir('', false, 'linux', exec);
    expect(result.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});
