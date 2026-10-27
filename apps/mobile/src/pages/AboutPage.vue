<script setup lang="ts">
import { computed } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneFacts from '../components/PhoneFacts.vue';

// The board "Réglages, à propos": what the desktop's "À propos" window shows. The version, the build, the author
// (the name over the email address, which opens the mail app) and the licence, then the description and the features.
// The values are injected at build time; a test run has none.
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const build = typeof __APP_BUILD_TIMESTAMP__ === 'string' ? __APP_BUILD_TIMESTAMP__ : '';
const authorName = typeof __APP_AUTHOR_NAME__ === 'string' ? __APP_AUTHOR_NAME__ : '';
const authorEmail = typeof __APP_AUTHOR_EMAIL__ === 'string' ? __APP_AUTHOR_EMAIL__ : '';
const license = typeof __APP_LICENSE__ === 'string' ? __APP_LICENSE__ : '';

const facts = computed(() => [
  { label: t('settings.aboutVersionLabel'), value: version },
  { label: t('settings.aboutBuildLabel'), value: build },
  {
    label: t('settings.aboutAuthorLabel'),
    value: authorName,
    link: authorEmail ? { text: authorEmail, href: `mailto:${authorEmail}` } : undefined,
  },
  { label: t('settings.aboutLicenseLabel'), value: license },
]);

// The desktop's features are one text, separated by middle dots.
const features = computed(() =>
  t('settings.aboutFeatures')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean),
);
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('settings.aboutTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-section-gap">
        <PhoneFacts :facts="facts" />
        <p class="mob-text m-body">{{ t('settings.aboutDesc') }}</p>
        <ul class="mob-bullets m-body">
          <li v-for="(item, i) in features" :key="i">{{ item }}</li>
        </ul>
      </div>
    </IonContent>
  </IonPage>
</template>
