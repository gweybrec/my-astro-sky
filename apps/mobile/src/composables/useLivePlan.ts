import { watch } from 'vue';
import type { Router } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { resolvePlanNight } from '@myastrosky/core/targets/plan';
import type { LiveAlertsPort } from '@myastrosky/core/targets/live-plan';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { createWebLiveAlerts } from '@myastrosky/render/live-alerts-web';
import { isNativePlatform } from '../platform-init';
import { LivePlan, createNativeLiveAlerts, type LivePlanPlugin } from '../live-alerts-native';
import { useConfirm } from './useConfirm';
import { useErrorToast } from './useErrorToast';
import { planLookups } from './usePlans';
import { targetsPrefs } from './useTargets';

/**
 * Connects the live plan once the catalogues are loaded (the plan's targets are resolved against them): its night from
 * the Targets' settings, its alerts as the phone's notifications (a browser's while developing), the buttons of the
 * notification, the app coming back to the front, and the question "Archiver le plan ?" when it has finished
 * (board "Plan, en direct, terminé"), wherever the app is.
 */
export async function installLivePlan(
  router: Router,
  native = isNativePlatform(),
  plugin: LivePlanPlugin = LivePlan,
): Promise<void> {
  const live = useLivePlanStore();
  const plans = usePlansStore();
  await plans.ensureLoaded();
  const alerts: LiveAlertsPort = native ? createNativeLiveAlerts(plugin) : createWebLiveAlerts();
  live.install({
    resolveNight: (p) => resolvePlanNight(p, targetsPrefs, planLookups),
    alerts,
    t,
    clock: (ms) => formatClock24(new Date(ms)),
  });

  if (native) {
    // A button of the notification, or a tap on it: the app opens (it may have been killed) on the plan.
    await plugin.addListener('action', ({ action }) => {
      const planId = live.state?.planId;
      if (action === 'skip') live.skip();
      else if (action === 'extend') live.extend();
      else if (action === 'stop') live.stop();
      if (planId) void router.push(`/plans/${planId}`);
    });
    const { App } = await import('@capacitor/app');
    await App.addListener('resume', () => live.refresh());
  }

  const { confirm } = useConfirm();
  let asking = false;
  watch(
    () => live.askArchive,
    async (ask) => {
      if (!ask || asking) return;
      asking = true;
      const yes = await confirm({
        title: t('live.status.finished'),
        message: t('live.archiveMessage', { name: live.plan?.name ?? '' }),
        confirmLabel: t('live.archiveYes'),
        cancelLabel: t('live.archiveNo'),
      });
      asking = false;
      live.answerArchive(yes);
    },
    { immediate: true },
  );
}

/**
 * Starts the plan (button "Démarrer le plan"), then on the phone asks for the notifications and, when Android does not
 * allow exact alarms, offers its settings (board "Plan, en direct, alertes à l'heure"). The plan is followed in the app
 * whatever the answers.
 */
export async function startLivePlan(
  planId: string,
  native = isNativePlatform(),
  plugin: LivePlanPlugin = LivePlan,
): Promise<void> {
  const live = useLivePlanStore();
  const { showWarning } = useErrorToast();
  live.start(planId);
  if (!native) return;
  const { granted } = await plugin.requestNotifications();
  if (!granted) {
    void showWarning(t('live.notificationsOff'));
    return;
  }
  // The notification may have been refused until now: hand the steps over again.
  live.refresh();
  if ((await plugin.exactAlarms()).granted) return;
  const { confirm } = useConfirm();
  const open = await confirm({
    title: t('live.exactTitle'),
    message: t('live.exactMessage'),
    confirmLabel: t('live.exactOpen'),
    cancelLabel: t('live.exactLater'),
  });
  if (open) await plugin.openExactAlarmSettings();
}
