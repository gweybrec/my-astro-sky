import { wrapExecForWSL } from './wsl-utils.js';

export type ExecAsync = (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;

interface ExecError extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
}

function execErrorFields(err: unknown): { code: number; stdout: string; stderr: string } {
  const e = err as ExecError;
  const code = typeof e.code === 'number' ? e.code : (e.code === 'ENOENT' ? -1 : 1);
  return { code, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
}

// ─── ASTAP probe ─────────────────────────────────────────────────────────────

export interface AstapProbeOk   { ok: true;  output: string }
export interface AstapProbeErr  { ok: false; code: number; stdout: string; stderr: string }
export type AstapProbeResult = AstapProbeOk | AstapProbeErr;

export async function probeAstap(
  binPath: string,
  useWSL: boolean,
  exec: ExecAsync,
): Promise<AstapProbeResult> {
  if (!binPath.trim()) return { ok: false, code: -1, stdout: '', stderr: '' };
  const { cmd, args } = wrapExecForWSL(binPath, [], useWSL);
  try {
    const { stdout } = await exec(cmd, args, { timeout: 5_000 });
    return { ok: true, output: stdout.trim().split('\n').slice(0, 2).join('\n') };
  } catch (err) {
    return { ok: false, ...execErrorFields(err) };
  }
}

// ─── solve-field probe ────────────────────────────────────────────────────────

export interface SolveFieldProbeOk  { ok: true;  version: string }
export interface SolveFieldProbeErr { ok: false; code: number; stdout: string; stderr: string }
export type SolveFieldProbeResult = SolveFieldProbeOk | SolveFieldProbeErr;

export async function probeSolveField(
  binPath: string,
  useWSL: boolean,
  exec: ExecAsync,
): Promise<SolveFieldProbeResult> {
  if (!binPath.trim()) return { ok: false, code: -1, stdout: '', stderr: '' };
  const { cmd, args } = wrapExecForWSL(binPath, ['--version'], useWSL);
  try {
    const { stdout } = await exec(cmd, args, { timeout: 5_000 });
    return { ok: true, version: stdout.trim() };
  } catch (err) {
    return { ok: false, ...execErrorFields(err) };
  }
}

// ─── data-dir probe ───────────────────────────────────────────────────────────

export interface DataDirProbeOk  { ok: true;  output: string }
export interface DataDirProbeErr { ok: false; code: number; output: string }
export type DataDirProbeResult = DataDirProbeOk | DataDirProbeErr;

export async function probeDataDir(
  dir: string,
  useWSL: boolean,
  platform: string,
  exec: ExecAsync,
): Promise<DataDirProbeResult> {
  if (!dir.trim()) return { ok: false, code: -1, output: '' };

  let cmd: string;
  let args: string[];

  if (useWSL) {
    ({ cmd, args } = wrapExecForWSL('ls', ['-1', dir], true));
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'dir', '/b', dir];
  } else {
    cmd = 'ls';
    args = ['-1', dir];
  }

  try {
    const { stdout } = await exec(cmd, args, { timeout: 5_000 });
    return { ok: true, output: stdout };
  } catch (err) {
    const e = err as ExecError;
    const code = typeof e.code === 'number' ? e.code : (e.code === 'ENOENT' ? -1 : 1);
    const output = (e.stdout ?? '') + (e.stderr ? '\n' + e.stderr : '');
    return { ok: false, code, output };
  }
}
