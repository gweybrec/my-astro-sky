// Starts and stops the processes of a run: free ports, a temporary folder, process trees, the check that ports are free.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** A set-up problem (exit code 2): the message says what to do. */
export class SetupError extends Error {}

const RESERVED = new Set([5173, 5174, 3001]);

/** A free port that is none of the development ports, found by asking the system and checking it is not reserved. */
export async function freePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port: p } = server.address();
        server.close(() => resolve(p));
      });
    });
    if (!RESERVED.has(port)) return port;
  }
  throw new SetupError('No free port found: close some programs and run again.');
}

/** True when something accepts connections on the port (on either loopback address). */
export function portInUse(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((r) => r.some(Boolean));
}

export const makeTempFolder = () => mkdtempSync(path.join(os.tmpdir(), 'check-alignment-'));
export const removeFolder = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* reported by the caller's check */
  }
};

/** Starts `node args...` as a process of its own; the output is kept to explain a failure. */
export function startNode(spec) {
  const child = spawn(process.execPath, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const handle = { name: spec.name, child, pid: child.pid, output: '', exited: false };
  const keep = (chunk) => {
    handle.output = (handle.output + chunk).slice(-4000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.once('exit', () => {
    handle.exited = true;
  });
  return handle;
}

/** Waits until the url answers (any status), or throws a SetupError naming the process. */
export async function waitReady(handle, url, seconds = 90) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (handle.exited) {
      throw new SetupError(
        `${handle.name} stopped at start-up: ${handle.output.trim().split('\n').slice(-2).join(' | ')}`,
      );
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new SetupError(`${handle.name} did not answer on ${url} within ${seconds} s.`);
}

/** Kills the process and everything it started. */
export function killTree(handle) {
  if (!handle || !handle.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(handle.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-handle.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
