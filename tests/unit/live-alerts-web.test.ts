import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebLiveAlerts, type WebNotifier } from '@myastrosky/render/live-alerts-web';
import type { LiveNotice } from '@myastrosky/core/targets/live-plan';

const notice = (atMs: number, title: string): LiveNotice => ({
  kind: 'end',
  atMs,
  title,
  body: '',
  status: { title: '', body: '', actions: [] },
  finished: false,
});

function notifier(allowed = true) {
  const close = vi.fn();
  const n = {
    permission: vi.fn().mockResolvedValue(allowed),
    show: vi.fn(() => ({ close })),
  } satisfies WebNotifier;
  return { n, close };
}

afterEach(() => vi.useRealTimers());

describe('the live plan in a browser window', () => {
  it('raises each alert at its time, the new one replacing the last', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { n, close } = notifier();
    await createWebLiveAlerts(n).sync('p1', { title: '', body: '', actions: [] }, [
      notice(1000, 'one'),
      notice(2000, 'two'),
      notice(-5, 'past'),
    ]);
    vi.advanceTimersByTime(1000);
    expect(n.show).toHaveBeenCalledWith('one', '', 'live-plan');
    vi.advanceTimersByTime(1000);
    expect(n.show).toHaveBeenLastCalledWith('two', '', 'live-plan');
    expect(n.show).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a new schedule or clear drops the timers; refused notifications raise nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { n } = notifier();
    const port = createWebLiveAlerts(n);
    await port.sync('p1', { title: '', body: '', actions: [] }, [notice(1000, 'one')]);
    await port.clear();
    vi.advanceTimersByTime(2000);
    expect(n.show).not.toHaveBeenCalled();
    const refused = notifier(false);
    await createWebLiveAlerts(refused.n).sync('p1', { title: '', body: '', actions: [] }, [
      notice(1000, 'one'),
    ]);
    vi.advanceTimersByTime(2000);
    expect(refused.n.show).not.toHaveBeenCalled();
  });
});
