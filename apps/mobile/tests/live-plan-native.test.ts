import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { LiveNotice } from '@myastrosky/core/targets/live-plan';

const confirm = vi.fn();
const showWarning = vi.fn();
vi.mock('../src/composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('../src/composables/useErrorToast', () => ({ useErrorToast: () => ({ showWarning }) }));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => ({}),
}));

import {
  createNativeLiveAlerts,
  nativeSteps,
  type LivePlanPlugin,
} from '../src/live-alerts-native';
import { startLivePlan } from '../src/composables/useLivePlan';
import { useLivePlanStore } from '@myastrosky/app-state/stores/live-plan';

function fakePlugin(over: Partial<Record<keyof LivePlanPlugin, unknown>> = {}) {
  return {
    schedule: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    requestNotifications: vi.fn().mockResolvedValue({ granted: true }),
    exactAlarms: vi.fn().mockResolvedValue({ granted: true }),
    openExactAlarmSettings: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(),
    ...over,
  } as unknown as LivePlanPlugin & Record<keyof LivePlanPlugin, ReturnType<typeof vi.fn>>;
}

const notice: LiveNotice = {
  kind: 'switch',
  atMs: 1000,
  title: 'Passez à M42',
  body: 'M31 terminé · jusqu’à 02:00',
  status: {
    title: 'M42 jusqu’à 02:00',
    body: 'Dernière cible du plan',
    actions: ['skip', 'extend', 'stop'],
  },
  finished: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('lang', 'fr');
  configureStorage(createMemoryStore());
  setActivePinia(createPinia());
});

describe('the live plan on the phone', () => {
  it('hands every step to the plugin: the visible text, its buttons and the alert', async () => {
    expect(nativeSteps([notice])).toEqual([
      {
        atMs: 1000,
        statusTitle: 'M42 jusqu’à 02:00',
        statusBody: 'Dernière cible du plan',
        actions: ['skip', 'extend', 'stop'],
        finished: false,
        alertTitle: 'Passez à M42',
        alertBody: 'M31 terminé · jusqu’à 02:00',
      },
    ]);
    const plugin = fakePlugin();
    await createNativeLiveAlerts(plugin).sync(
      'p1',
      { title: 'Début à 21:00', body: 'Premier : M31', actions: ['stop'] },
      [notice],
    );
    const sent = plugin.schedule.mock.calls[0][0];
    expect(sent.planId).toBe('p1');
    expect(sent.status).toEqual({
      statusTitle: 'Début à 21:00',
      statusBody: 'Premier : M31',
      actions: ['stop'],
      finished: false,
    });
    expect(sent.steps).toHaveLength(1);
    expect(sent.labels).toMatchObject({ skip: 'Passer', extend: '+10 min', stop: 'Arrêter' });
  });

  it('starting asks for the notifications; refused, the plan is followed in the app only', async () => {
    const plugin = fakePlugin({
      requestNotifications: vi.fn().mockResolvedValue({ granted: false }),
    });
    await startLivePlan('p1', true, plugin);
    expect(useLivePlanStore().state?.planId).toBe('p1');
    expect(showWarning).toHaveBeenCalledWith(
      'Notifications désactivées : le plan est suivi dans l’app seulement',
    );
    expect(plugin.exactAlarms).not.toHaveBeenCalled();
  });

  it('without exact alarms, offers Android\'s settings ("Plan, en direct, alertes à l\'heure")', async () => {
    const plugin = fakePlugin({ exactAlarms: vi.fn().mockResolvedValue({ granted: false }) });
    confirm.mockResolvedValue(true);
    await startLivePlan('p1', true, plugin);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Alertes à l’heure',
        confirmLabel: 'Ouvrir les réglages',
        cancelLabel: 'Plus tard',
      }),
    );
    expect(plugin.openExactAlarmSettings).toHaveBeenCalled();
  });

  it('"Plus tard" leaves the settings closed; with exact alarms nothing is asked', async () => {
    const later = fakePlugin({ exactAlarms: vi.fn().mockResolvedValue({ granted: false }) });
    confirm.mockResolvedValue(false);
    await startLivePlan('p1', true, later);
    expect(later.openExactAlarmSettings).not.toHaveBeenCalled();
    confirm.mockClear();
    await startLivePlan('p1', true, fakePlugin());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('in a browser, starting asks nothing of Android', async () => {
    const plugin = fakePlugin();
    await startLivePlan('p1', false, plugin);
    expect(useLivePlanStore().state?.planId).toBe('p1');
    expect(plugin.requestNotifications).not.toHaveBeenCalled();
  });
});
