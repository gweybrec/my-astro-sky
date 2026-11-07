<script setup lang="ts">
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../components/PhoneToggleRow.vue';
import { autoRotateLandscape, loadPhotoDisplay, setAutoRotateLandscape } from '../photo-display';

// The board "Réglages, affichage": how photos are shown. Its one setting, under "Galerie", turns a landscape photo a
// quarter on an upright phone (on at first); the change applies at once and is kept on the phone.
loadPhotoDisplay();
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.photo.display') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhoneSectionHeader>{{ t('app.viewModeGallery') }}</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneToggleRow
            :model-value="autoRotateLandscape"
            :title="t('mobile.settings.autoRotate')"
            :sub="t('mobile.settings.autoRotateHelp')"
            @update:model-value="setAutoRotateLandscape"
          />
        </IonList>
      </div>
    </IonContent>
  </IonPage>
</template>
