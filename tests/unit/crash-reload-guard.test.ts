import { describe, it, expect } from 'vitest';
import { shouldReloadAfterCrash, DEFAULT_RELOAD_GUARD } from '../../electron/crash-reload-guard';

describe('shouldReloadAfterCrash', () => {
  const opts = { maxReloads: 3, windowMs: 60_000 };

  it('reloads on the first crash', () => {
    const r = shouldReloadAfterCrash([], 1000, opts);
    expect(r.reload).toBe(true);
    expect(r.recentCrashes).toEqual([1000]);
  });

  it('reloads up to maxReloads within the window', () => {
    let times: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = shouldReloadAfterCrash(times, i * 1000, opts);
      times = r.recentCrashes;
      expect(r.reload).toBe(true);
    }
    expect(times).toEqual([1000, 2000, 3000]);
  });

  it('gives up on the crash that exceeds maxReloads within the window', () => {
    const previous = [1000, 2000, 3000];
    const r = shouldReloadAfterCrash(previous, 4000, opts);
    expect(r.reload).toBe(false);
    expect(r.recentCrashes).toEqual([1000, 2000, 3000, 4000]);
  });

  it('drops crashes that fall outside the rolling window', () => {
    // Three old crashes, all older than windowMs before the new one.
    const previous = [1000, 2000, 3000];
    const now = 3000 + 60_001;
    const r = shouldReloadAfterCrash(previous, now, opts);
    expect(r.reload).toBe(true);
    expect(r.recentCrashes).toEqual([now]);
  });

  it('keeps only in-window crashes when deciding', () => {
    // 1000 is outside the window relative to now; the two recent ones plus now == 3 <= max.
    const previous = [1000, 90_000, 95_000];
    const now = 100_000;
    const r = shouldReloadAfterCrash(previous, now, opts);
    expect(r.reload).toBe(true);
    expect(r.recentCrashes).toEqual([90_000, 95_000, 100_000]);
  });

  it('exposes sensible defaults', () => {
    expect(DEFAULT_RELOAD_GUARD.maxReloads).toBe(3);
    expect(DEFAULT_RELOAD_GUARD.windowMs).toBe(60_000);
  });
});
