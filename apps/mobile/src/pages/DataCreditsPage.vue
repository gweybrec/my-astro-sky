<script setup lang="ts">
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { dataCreditSections } from '@myastrosky/core/data-credits';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneCredit from '../components/PhoneCredit.vue';

// The board "Réglages, crédits des données": the desktop's data credits, section by section (the catalogues, the
// reference documents, the online data with the line saying it is downloaded, not shipped).
const sections = dataCreditSections();
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('settings.dataCreditsTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <template v-for="section in sections" :key="section.label">
          <PhoneSectionHeader>{{ section.label }}</PhoneSectionHeader>
          <PhoneHelper v-if="section.intro">{{ section.intro }}</PhoneHelper>
          <IonList class="mob-list" lines="none">
            <PhoneCredit v-for="credit in section.credits" :key="credit.name" :credit="credit" />
          </IonList>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>
