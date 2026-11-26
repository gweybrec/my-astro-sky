// The live plan's notifications on the phone, through the app's Android plugin (LivePlanPlugin.java): every step of
// the night is handed over at once, and exact alarms show them while the app is killed. A button of the notification
// (Skip, +10 min, Stop) opens the app and comes back as an action.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { t } from '@myastrosky/core/i18n/index';
import type {
  LiveAction,
  LiveAlertsPort,
  LiveNotice,
  LiveStatusText,
} from '@myastrosky/core/targets/live-plan';

/** A step of the night as the plugin takes it: the visible notification from `atMs`, and the alert to vibrate with. */
export interface NativeLiveStep {
  atMs: number;
  statusTitle: string;
  statusBody: string;
  actions: LiveAction[];
  finished: boolean;
  alertTitle: string;
  alertBody: string;
}

export interface LivePlanPlugin {
  schedule(options: {
    planId: string;
    status: { statusTitle: string; statusBody: string; actions: LiveAction[]; finished: false };
    steps: NativeLiveStep[];
    labels: Record<string, string>;
  }): Promise<void>;
  clear(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  exactAlarms(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  addListener(
    event: 'action',
    listener: (data: { action: LiveAction | 'open' }) => void,
  ): Promise<PluginListenerHandle>;
}

export const LivePlan = registerPlugin<LivePlanPlugin>('LivePlan');

/** The steps handed to the plugin, in time order. */
export function nativeSteps(notices: readonly LiveNotice[]): NativeLiveStep[] {
  return notices.map((n) => ({
    atMs: n.atMs,
    statusTitle: n.status.title,
    statusBody: n.status.body,
    actions: n.status.actions,
    finished: n.finished,
    alertTitle: n.title,
    alertBody: n.body,
  }));
}

/** The buttons' and channels' names, in the app's language. */
export function nativeLabels(): Record<string, string> {
  return {
    skip: t('live.skip'),
    extend: t('live.extend'),
    stop: t('live.stop'),
    channelStatus: t('live.channelStatus'),
    channelAlerts: t('live.channelAlerts'),
  };
}

export function createNativeLiveAlerts(plugin: LivePlanPlugin = LivePlan): LiveAlertsPort {
  return {
    async sync(planId: string, status: LiveStatusText, notices: LiveNotice[]) {
      await plugin.schedule({
        planId,
        status: {
          statusTitle: status.title,
          statusBody: status.body,
          actions: status.actions,
          finished: false,
        },
        steps: nativeSteps(notices),
        labels: nativeLabels(),
      });
    },
    clear: () => plugin.clear(),
  };
}
