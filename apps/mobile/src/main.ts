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
import { resetTargetsNightToToday } from '@myastrosky/core/targets/prefs';
import {
  initPlatform,
  installBackButton,
  isNativePlatform,
  saveBackupWithoutUpdates,
} from './platform-init';
import { startOpenWith } from './open-with';
import { catalogsReady } from './catalogs';
import { checkAstrometryKey } from './key-check';
import { repairStoredPhotoSizes } from './photo-sizes';
import { resumeImport } from './composables/usePhotoImport';
import { installLivePlan } from './composables/useLivePlan';
import { reportError } from '@myastrosky/core/platform/error-hook';

// An error nothing caught (a promise left unhandled, a component that throws) is still logged, as on the desktop.
window.addEventListener('error', (event) => {
  reportError('renderer_uncaught_error', event.error ?? event.message, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  reportError('renderer_unhandled_rejection', event.reason);
});

async function start(): Promise<void> {
  try {
    await initPlatform();
  } catch (error) {
    reportError('startup_failed', error);
    // A plain full-screen message with the error's text and a retry button, not a blank page; after a failed
    // database update, also the full backup of the data it left intact.
    const message = error instanceof Error ? error.message : String(error);
    const saveBackup = isDatabaseUpdateError(error) ? saveBackupWithoutUpdates : undefined;
    createApp(StartupError, { message, saveBackup }).mount('#app');
    return;
  }
  // The Targets search keeps its filters across launches, but its night starts on today, as on the desktop.
  resetTargetsNightToToday();
  const app = createApp(App);
  app.config.errorHandler = (err, instance, info) => {
    reportError('vue_component_error', err, {
      info,
      component: (instance as { $options?: { name?: string } } | null)?.$options?.name ?? 'unknown',
    });
  };
  app.use(IonicVue).use(createPinia()).use(router).mount('#app');
  installBackButton(router);
  // An import left unsaved when the app was closed opens again, then the files opened with MyAstroSky from another
  // app join it, then the astrometry.net key is checked.
  void router
    .isReady()
    .then(() => resumeImport(() => router.push('/gallery/import')))
    .then(() => (isNativePlatform() ? startOpenWith(router) : undefined))
    .then(() => checkAstrometryKey(() => router.push('/settings/astrometry-key')));
  // After the first screen is up: the gear lists and the star and deep-sky registries (screens wait on the same promise),
  // then, last, the sizes of the photos stored without one.
  void catalogsReady()
    .catch(() => undefined)
    .then(() => repairStoredPhotoSizes());
  // The live plan resolves its targets against the catalogues: it is connected once they are loaded.
  void catalogsReady()
    .then(() => router.isReady())
    .then(() => installLivePlan(router))
    .catch((error) => reportError('live plan', error));
}

void start();
