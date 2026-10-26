// Shared helpers for the device scripts: find adb, run it against ONE device (always with -s <serial>),
// read the app's package id from apps/mobile/capacitor.config.ts. Not run on its own.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** adb from $ADB, else $ANDROID_HOME/platform-tools, else the default SDK folder, else the PATH. */
export function adbPath() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', exe),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe),
  ];
  return candidates.find((c) => c && existsSync(c)) ?? 'adb';
}

/** Runs `adb -s <serial> ...args` and returns stdout (a Buffer when `binary` is true). */
export function adb(serial, args, { binary = false } = {}) {
  if (!serial)
    throw new Error('A device serial is required: every adb command carries -s <serial>.');
  const out = execFileSync(adbPath(), ['-s', serial, ...args], {
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    maxBuffer: 256 * 1024 * 1024,
  });
  return binary ? out : out.toString().trim();
}

/** The devices adb lists, with their state ("device", "unauthorized", "offline"). */
export function listDevices() {
  const out = execFileSync(adbPath(), ['devices'], { env: process.env }).toString();
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

/** The app's package id, read from apps/mobile/capacitor.config.ts. */
export function appId() {
  const text = readFileSync(path.join(repoRoot, 'apps/mobile/capacitor.config.ts'), 'utf8');
  const m = text.match(/appId:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('appId not found in apps/mobile/capacitor.config.ts');
  return m[1];
}

/** Command-line arguments: positional ones, and `--name value` pairs. */
export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, options };
}
