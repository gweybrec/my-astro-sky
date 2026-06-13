import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { ServerSettings } from '../api';
import {
  loadServerSettings,
  saveServerSettings,
  clearAstrometryApiKey as clearApiKeyApi,
} from '../api';

export const useSettingsStore = defineStore('settings', () => {
  const serverSettings = shallowRef<ServerSettings | null>(null);

  async function load() {
    try {
      serverSettings.value = await loadServerSettings();
    } catch {
      // server may not be available yet
    }
  }

  async function save(payload: Parameters<typeof saveServerSettings>[0]) {
    await saveServerSettings(payload);
    serverSettings.value = await loadServerSettings();
  }

  async function clearApiKey() {
    await clearApiKeyApi();
    serverSettings.value = await loadServerSettings();
  }

  return { serverSettings, load, save, clearApiKey };
});
