import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
// Registers the App plugin, which Ionic's hardware back button uses on Android.
import '@capacitor/app';
import './theme/index.css';
import App from './App.vue';
import StartupError from './components/StartupError.vue';
import router from './router';
import { initPlatform } from './platform-init';

async function start(): Promise<void> {
  try {
    await initPlatform();
  } catch (error) {
    console.error('Start-up failed', error);
    // A plain full-screen message with the error's text and a retry button, not a blank page.
    const message = error instanceof Error ? error.message : String(error);
    createApp(StartupError, { message }).mount('#app');
    return;
  }
  createApp(App).use(IonicVue).use(createPinia()).use(router).mount('#app');
}

void start();
