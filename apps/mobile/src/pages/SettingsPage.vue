<script setup lang="ts">
import { ref } from 'vue';
import { IonPage, IonHeader, IonContent, IonSelect, IonSelectOption } from '@ionic/vue';
import { getLang, setLang, t, type Lang } from '@myastrosky/core/i18n/index';
import AppIcon from '../components/AppIcon.vue';
import chevronIcon from '../icons/chevron-right.svg?raw';

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
  if (event.detail.value !== current) setLang(event.detail.value);
}
</script>

<template>
  <IonPage>
    <IonHeader class="mob-topbar">
      <h1 class="mob-topbar-title m-title">{{ t('settings.section') }}</h1>
    </IonHeader>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <template v-for="section in sections" :key="section.title">
          <h2 class="mob-section-header m-secondary">{{ t(section.title) }}</h2>
          <div style="background: var(--bg-panel)">
            <button
              v-for="row in section.rows"
              :key="row"
              type="button"
              class="mob-row"
              @click="onRow(row, $event)"
            >
              <span class="mob-row-body">
                <span class="mob-row-title m-body">{{ t(row) }}</span>
              </span>
              <span class="mob-row-trail m-secondary">
                <span v-if="row === LANGUAGE_ROW">{{ t(currentName) }}</span>
                <span class="mob-row-chevron" aria-hidden="true"
                  ><AppIcon :svg="chevronIcon"
                /></span>
              </span>
            </button>
          </div>
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
