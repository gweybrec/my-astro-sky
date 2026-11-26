// The live plan's alerts in a browser window (the desktop app, the phone app run in a browser): system notifications
// raised on timers while the window is open. Nothing survives closing it; the live state does, and the next start
// schedules again from the current time.

import type {
  LiveAlertsPort,
  LiveNotice,
  LiveStatusText,
} from '@myastrosky/core/targets/live-plan';

/** The longest delay a timer accepts (about 24.8 days). */
const MAX_DELAY = 2 ** 31 - 1;

type NotificationLike = { close(): void };
export interface WebNotifier {
  /** Whether notifications may show; asked the first time. */
  permission(): Promise<boolean>;
  show(title: string, body: string, tag: string): NotificationLike | null;
}

/** The browser's own notifications. */
export const browserNotifier: WebNotifier = {
  async permission() {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
  },
  show(title, body, tag) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
    return new Notification(title, { body, tag, silent: false });
  },
};

export function createWebLiveAlerts(notifier: WebNotifier = browserNotifier): LiveAlertsPort {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let last: NotificationLike | null = null;
  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers = [];
  };
  return {
    async sync(_planId: string, _status: LiveStatusText, notices: LiveNotice[]) {
      clearTimers();
      if (!(await notifier.permission())) return;
      const now = Date.now();
      for (const n of notices) {
        const delay = n.atMs - now;
        if (delay <= 0 || delay > MAX_DELAY) continue;
        timers.push(
          setTimeout(() => {
            last?.close();
            // One tag: a new alert replaces the previous one, as on the phone.
            last = notifier.show(n.title, n.body, 'live-plan');
          }, delay),
        );
      }
    },
    async clear() {
      clearTimers();
      last?.close();
      last = null;
    },
  };
}
