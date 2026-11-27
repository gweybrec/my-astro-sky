import { describe, it, expect, vi, beforeEach } from 'vitest';

const read = vi.fn();
const saveFile = vi.fn((_name: string, _blob: Blob) => Promise.resolve());
const log = { read: () => read() };
let hasLog = true;
vi.mock('../src/platform-init', () => ({ phoneErrorLog: () => (hasLog ? log : null) }));
vi.mock('../src/platform-device', () => ({
  saveFile: (name: string, blob: Blob) => saveFile(name, blob),
}));

import { shareErrorLog } from '../src/error-log-share';

beforeEach(() => {
  read.mockReset();
  saveFile.mockClear();
  hasLog = true;
});

describe('sharing the error log', () => {
  it('hands the whole log to the share sheet, named with the day', async () => {
    read.mockResolvedValue('{"ref":"AB12"}\n');
    expect(await shareErrorLog(new Date('2026-11-27T10:00:00Z'))).toBe(true);
    const [name, blob] = saveFile.mock.calls[0] as unknown as [string, Blob];
    expect(name).toBe('myastrosky-errors-2026-11-27.jsonl');
    expect(await blob.text()).toBe('{"ref":"AB12"}\n');
  });

  it('shares nothing when no error was logged, or when there is no log (a browser)', async () => {
    read.mockResolvedValue('');
    expect(await shareErrorLog()).toBe(false);
    hasLog = false;
    expect(await shareErrorLog()).toBe(false);
    expect(saveFile).not.toHaveBeenCalled();
  });
});
