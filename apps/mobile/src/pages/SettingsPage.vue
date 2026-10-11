<script setup lang="ts">
import { ref } from 'vue';
import { IonPage, IonContent, IonList, IonSelect, IonSelectOption } from '@ionic/vue';
import { getLang, setLang, t, type Lang } from '@myastrosky/core/i18n/index';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneRow from '../components/PhoneRow.vue';

const LANGUAGE_ROW = 'settings.languageLabel';

// The entries of the board "Réglages", as static rows (their screens are later cards), except the language.
const sections = [
  {
    title: 'mobile.settings.observation',
    rows: ['mobile.settings.setups', 'targets.location.label'],
  },
  { title: 'settings.appearanceSection', rows: [LANGUAGE_ROW, 'settings.themeLabel'] },
  { title: 'settings.astrometryNetSection', rows: ['mobile.settings.astrometryKey'] },
  {
    title: 'mobile.settings.computerSection',
    rows: ['mobile.settings.computerConnection', 'mobile.settings.exportImport'],
  },
  { title: 'settings.legalSection', rows: ['mobile.settings.about'] },
];

const languages: { code: Lang; name: string }[] = [
  { code: 'fr', name: 'mobile.settings.langFr' },
  { code: 'en', name: 'mobile.settings.langEn' },
  { code: 'es', name: 'mobile.settings.langEs' },
  { code: 'de', name: 'mobile.settings.langDe' },
];

const current = getLang();
const currentName = languages.find((l) => l.code === current)?.name ?? '';
const select = ref<{ $el: HTMLIonSelectElement } | null>(null);

// Ionic's own select, opened from the row; choosing a language applies it at once (the page reloads).
function onRow(row: string, event: Event) {
  if (row === LANGUAGE_ROW) void select.value?.$el.open(event as UIEvent);
}
function onChange(event: CustomEvent<{ value: Lang }>) {
  if (event.detail.value === current) return;
  document.documentElement.lang = event.detail.value;
  setLang(event.detail.value);
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <h1 class="mob-topbar-title m-title">{{ t('settings.section') }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <template v-for="section in sections" :key="section.title">
          <PhoneSectionHeader>{{ t(section.title) }}</PhoneSectionHeader>
          <IonList class="mob-list" lines="none">
            <PhoneRow
              v-for="row in section.rows"
              :key="row"
              :title="t(row)"
              :value="row === LANGUAGE_ROW ? t(currentName) : undefined"
              button
              chevron
              @click="onRow(row, $event)"
            />
          </IonList>
        </template>
        <IonSelect
          ref="select"
          class="mob-lang-select"
          interface="action-sheet"
          :value="current"
          :header="t('settings.languageLabel')"
          :cancel-text="t('modal.cancel')"
          aria-hidden="true"
          @ion-change="onChange"
        >
          <IonSelectOption v-for="l in languages" :key="l.code" :value="l.code">
            {{ t(l.name) }}
          </IonSelectOption>
        </IonSelect>
      </div>
    </IonContent>
  </IonPage>
</template>

<style>
.mob-lang-select {
  display: none;
}
</style>
