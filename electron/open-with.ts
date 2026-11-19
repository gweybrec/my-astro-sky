/**
 * "Open with MyAstroSky": which launch arguments are photos to add, and the Windows registry entries that
 * list the app in Explorer's "Open with" menu for every photo format the app accepts. The entries only add
 * MyAstroSky to that menu; they never make it the default app for a format.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { ANY_PHOTO_EXT_RE } from '@myastrosky/core/photo-formats';

/** Every extension the photo picker accepts (kept in step with `ANY_PHOTO_EXT_RE` by a test). */
export const OPEN_WITH_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.fit',
  '.fits',
  '.xisf',
] as const;

const PROG_ID = 'MyAstroSky.Photo';
const CLASSES = 'HKCU\\Software\\Classes';

/**
 * The photo files named on a command line (the executable, the app folder and switches are skipped).
 * Linux file managers may pass `file://` addresses instead of paths.
 */
export function photoPathsFromArgv(argv: readonly string[]): string[] {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => (arg.startsWith('file://') ? fileURLToPath(arg) : arg))
    .filter((arg) => ANY_PHOTO_EXT_RE.test(arg));
}

/** The Squirrel installer event this launch is for (`--squirrel-install`, …), or null for a normal launch. */
export function squirrelEvent(argv: readonly string[]): string | null {
  const arg = argv[1];
  return arg?.startsWith('--squirrel-') ? arg : null;
}

/**
 * The executable Explorer should start: Squirrel's stub one folder above the versioned `app-x.y.z` folder,
 * which keeps working after every update.
 */
export function squirrelStubExe(execPath: string): string {
  return path.join(path.dirname(path.dirname(execPath)), path.basename(execPath));
}

/** `reg.exe` argument lists that add MyAstroSky to "Open with" for every accepted extension. */
export function registerOpenWithCommands(exePath: string): string[][] {
  const progKey = `${CLASSES}\\${PROG_ID}`;
  return [
    ['add', progKey, '/ve', '/d', 'MyAstroSky photo', '/f'],
    ['add', `${progKey}\\DefaultIcon`, '/ve', '/d', `"${exePath}",0`, '/f'],
    ['add', `${progKey}\\shell\\open\\command`, '/ve', '/d', `"${exePath}" "%1"`, '/f'],
    ...OPEN_WITH_EXTENSIONS.map((ext) => [
      'add',
      `${CLASSES}\\${ext}\\OpenWithProgids`,
      '/v',
      PROG_ID,
      '/t',
      'REG_NONE',
      '/f',
    ]),
  ];
}

/** `reg.exe` argument lists that take MyAstroSky out of "Open with" again (on uninstall). */
export function unregisterOpenWithCommands(): string[][] {
  return [
    ['delete', `${CLASSES}\\${PROG_ID}`, '/f'],
    ...OPEN_WITH_EXTENSIONS.map((ext) => [
      'delete',
      `${CLASSES}\\${ext}\\OpenWithProgids`,
      '/v',
      PROG_ID,
      '/f',
    ]),
  ];
}

/**
 * Collects paths that arrive close together into one batch: Explorer may start one process per selected
 * file, and each one reaches the running app separately.
 */
export function createPathBatcher(
  onBatch: (paths: string[]) => void,
  delayMs = 300,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): (paths: readonly string[]) => void {
  let pending: string[] = [];
  let handle: unknown = null;
  return (paths) => {
    if (paths.length === 0) return;
    for (const p of paths) if (!pending.includes(p)) pending.push(p);
    if (handle !== null) timers.clear(handle);
    handle = timers.set(() => {
      handle = null;
      const batch = pending;
      pending = [];
      onBatch(batch);
    }, delayMs);
  };
}
