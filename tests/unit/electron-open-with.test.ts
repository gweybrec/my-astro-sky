/**
 * Tests for electron/open-with.ts: which launch arguments are photos to add, the Explorer "Open with"
 * registry entries, and how files opened one by one are grouped.
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
import { ANY_PHOTO_EXT_RE } from '@myastrosky/core/photo-formats';
import {
  OPEN_WITH_EXTENSIONS,
  createPathBatcher,
  photoPathsFromArgv,
  registerOpenWithCommands,
  squirrelEvent,
  squirrelStubExe,
  unregisterOpenWithCommands,
} from '../../electron/open-with';

describe('OPEN_WITH_EXTENSIONS', () => {
  it('lists exactly the formats the photo picker accepts', () => {
    for (const ext of OPEN_WITH_EXTENSIONS) expect(ANY_PHOTO_EXT_RE.test(`a${ext}`)).toBe(true);
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'fit', 'fits', 'xisf']) {
      expect(OPEN_WITH_EXTENSIONS).toContain(`.${ext}`);
    }
  });
});

describe('photoPathsFromArgv', () => {
  it('keeps the photo files and skips the executable, switches and other files', () => {
    const argv = [
      'C:\\App\\MyAstroSky.exe',
      '--allow-file-access-from-files',
      'C:\\Photos\\M101.fit',
      'C:\\Photos\\notes.txt',
      'C:\\Photos\\M31.JPG',
    ];
    expect(photoPathsFromArgv(argv)).toEqual(['C:\\Photos\\M101.fit', 'C:\\Photos\\M31.JPG']);
  });

  it('turns file:// addresses into paths', () => {
    const file = path.resolve('M101.fits');
    expect(photoPathsFromArgv(['MyAstroSky', pathToFileURL(file).href])).toEqual([file]);
  });

  it('finds nothing in a plain launch', () => {
    expect(photoPathsFromArgv(['electron.exe', '.'])).toEqual([]);
  });
});

describe('squirrelEvent', () => {
  it('returns the installer event, or null for a normal launch', () => {
    expect(squirrelEvent(['MyAstroSky.exe', '--squirrel-install', '1.2.0'])).toBe(
      '--squirrel-install',
    );
    expect(squirrelEvent(['MyAstroSky.exe', 'C:\\M101.fit'])).toBeNull();
    expect(squirrelEvent(['MyAstroSky.exe'])).toBeNull();
  });
});

describe('squirrelStubExe', () => {
  it('points at the stub above the versioned app folder', () => {
    const exe = path.join('Local', 'MyAstroSky', 'app-1.2.0', 'MyAstroSky.exe');
    expect(squirrelStubExe(exe)).toBe(path.join('Local', 'MyAstroSky', 'MyAstroSky.exe'));
  });
});

describe('registry commands', () => {
  it('registers an open command and an OpenWithProgids entry per extension, never a default', () => {
    const cmds = registerOpenWithCommands('C:\\MyAstroSky\\MyAstroSky.exe');
    expect(cmds).toContainEqual([
      'add',
      'HKCU\\Software\\Classes\\MyAstroSky.Photo\\shell\\open\\command',
      '/ve',
      '/d',
      '"C:\\MyAstroSky\\MyAstroSky.exe" "%1"',
      '/f',
    ]);
    for (const ext of OPEN_WITH_EXTENSIONS) {
      expect(cmds).toContainEqual([
        'add',
        `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`,
        '/v',
        'MyAstroSky.Photo',
        '/t',
        'REG_NONE',
        '/f',
      ]);
    }
    // Writing the extension key's default value would make MyAstroSky the default app.
    expect(cmds.some((c) => c[1].endsWith(OPEN_WITH_EXTENSIONS[0]) && c[2] === '/ve')).toBe(false);
  });

  it('removes what it registered', () => {
    const cmds = unregisterOpenWithCommands();
    expect(cmds[0]).toEqual(['delete', 'HKCU\\Software\\Classes\\MyAstroSky.Photo', '/f']);
    expect(cmds).toHaveLength(1 + OPEN_WITH_EXTENSIONS.length);
  });
});

describe('createPathBatcher', () => {
  it('groups paths that arrive close together, once each', () => {
    vi.useFakeTimers();
    const onBatch = vi.fn();
    const queue = createPathBatcher(onBatch, 300);
    queue(['a.fit']);
    vi.advanceTimersByTime(200);
    queue(['b.jpg', 'a.fit']);
    vi.advanceTimersByTime(299);
    expect(onBatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBatch).toHaveBeenCalledWith(['a.fit', 'b.jpg']);
    queue([]);
    vi.advanceTimersByTime(1000);
    expect(onBatch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
