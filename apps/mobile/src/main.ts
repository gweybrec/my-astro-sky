import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
// Registers the App plugin, which Ionic's hardware back button uses on Android.
import '@capacitor/app';
import './theme/index.css';
import App from './App.vue';
import StartupError from './components/StartupError.vue';
import router from './router';
import { isDatabaseUpdateError } from '@myastrosky/core/db/schema';
import { initPlatform, installBackButton, saveBackupWithoutUpdates } from './platform-init';
import { catalogsReady } from './catalogs';
import { checkAstrometryKey } from './key-check';
import { repairStoredPhotoSizes } from './photo-sizes';

async function start(): Promise<void> {
  try {
    await initPlatform();
  } catch (error) {
    console.error('Start-up failed', error);
    // A plain full-screen message with the error's text and a retry button, not a blank page; after a failed
    // database update, also the full backup of the data it left intact.
    const message = error instanceof Error ? error.message : String(error);
    const saveBackup = isDatabaseUpdateError(error) ? saveBackupWithoutUpdates : undefined;
    createApp(StartupError, { message, saveBackup }).mount('#app');
    return;
  }
  createApp(App).use(IonicVue).use(createPinia()).use(router).mount('#app');
  installBackButton(router);
  void router
    .isReady()
    .then(() => checkAstrometryKey(() => router.push('/settings/astrometry-key')));
  // After the first screen is up: the gear lists and the star and deep-sky registries (screens wait on the same promise),
  // then, last, the sizes of the photos stored without one.
  void catalogsReady()
    .catch(() => undefined)
    .then(() => repairStoredPhotoSizes());
}

void start();
