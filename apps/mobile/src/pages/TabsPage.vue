<script setup lang="ts">
import { IonPage, IonTabs, IonTabBar, IonTabButton, IonRouterOutlet } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from '../components/AppIcon.vue';
import skyIcon from '@icons/local-sky.svg?raw';
import galleryIcon from '@icons/image.svg?raw';
import targetsIcon from '@icons/target.svg?raw';
import plansIcon from '@icons/plan-list.svg?raw';
import settingsIcon from '../icons/gear.svg?raw';

// The root is an IonPage: Ionic Vue's router needs one at the root of every route component, the tabs one included
// (without it, going back to a tab from a pushed page fails and the screen stays on the pushed page).
// Order, icons and labels of the board.
const tabs = [
  { tab: 'sky', label: 'mobile.tabs.sky', icon: skyIcon },
  { tab: 'gallery', label: 'app.viewModeGallery', icon: galleryIcon },
  { tab: 'targets', label: 'mobile.tabs.targets', icon: targetsIcon },
  { tab: 'plans', label: 'targets.viewMode', icon: plansIcon },
  { tab: 'settings', label: 'settings.section', icon: settingsIcon },
];
</script>

<template>
  <IonPage>
    <IonTabs>
      <IonRouterOutlet />
      <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -- slot of Ionic's web component, not a Vue 2 slot -->
      <IonTabBar slot="bottom" :aria-label="t('mobile.tabs.navLabel')">
        <IonTabButton
          v-for="item in tabs"
          :key="item.tab"
          :tab="item.tab"
          :href="`/tabs/${item.tab}`"
        >
          <span class="mob-tab-pill"><AppIcon :svg="item.icon" /></span>
          <span class="m-caption mob-tab-label">{{ t(item.label) }}</span>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  </IonPage>
</template>

<style>
.mob-tab-label {
  margin-top: var(--space-1);
}
</style>
