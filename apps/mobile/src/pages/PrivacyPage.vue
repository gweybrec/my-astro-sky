<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';

// The board "Réglages, confidentialité": the desktop's privacy texts, a title and a paragraph for each feature that
// reaches an outside server. The desktop's IP geolocation block is left out: the phone takes its position from the
// device.
const blocks = [
  { title: 'settings.privacyAstrometryTitle', text: 'settings.privacyAstrometry' },
  { title: 'settings.privacyHorizonTitle', text: 'settings.privacyHorizon' },
  { title: 'settings.privacyIdentifyTitle', text: 'settings.privacyIdentify' },
];
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('settings.privacyTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-section-gap-sm">
        <p class="mob-text m-body">{{ t('settings.privacyLocal') }}</p>
        <template v-for="block in blocks" :key="block.title">
          <h2 class="mob-text-title m-body-strong">{{ t(block.title) }}</h2>
          <p class="mob-text m-body">{{ t(block.text) }}</p>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>
