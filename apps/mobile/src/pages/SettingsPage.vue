<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonList,
  IonSelect,
  IonSelectOption,
  onIonViewWillEnter,
} from '@ionic/vue';
import { getLang, setLang, t, type Lang } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { formatLatLon, readObserverLocation } from '@myastrosky/core/observer-location';
import { getGearSetups, loadServerSettings } from '@myastrosky/app-state/api';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneRow from '../components/PhoneRow.vue';

const LANGUAGE_ROW = 'settings.languageLabel';

// The entries of the board "Réglages". A row whose screen is a later card, or has no board yet, is disabled.
interface RowDef {
  title: string;
  /** The route it opens; without one the row is disabled. */
  to?: string;
  value?: () => string | undefined;
  /** Shown instead of `value` in the success colour. */
  ok?: () => string | undefined;
}

const setupCount = ref<number | null>(null);
const location = ref('');
const keyConfigured = ref(false);
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

const sections: { title: string; rows: RowDef[] }[] = [
  {
    title: 'mobile.settings.observation',
    rows: [
      {
        title: 'mobile.settings.setups',
        to: '/settings/setups',
        value: () => (setupCount.value === null ? undefined : String(setupCount.value)),
      },
      {
        title: 'targets.location.label',
        to: '/settings/location',
        value: () => location.value || undefined,
      },
    ],
  },
  {
    title: 'settings.appearanceSection',
    rows: [
      { title: LANGUAGE_ROW },
      { title: 'settings.themeLabel', value: () => t('mobile.settings.themeValue') },
    ],
  },
  {
    title: 'settings.astrometryNetSection',
    rows: [
      {
        title: 'mobile.settings.astrometryKey',
        ok: () => (keyConfigured.value ? t('mobile.settings.keyConfigured') : undefined),
      },
    ],
  },
  {
    title: 'mobile.settings.computerSection',
    rows: [
      { title: 'mobile.settings.computerConnection', value: () => t('mobile.settings.lan') },
      { title: 'mobile.settings.exportImport', to: '/settings/backup' },
    ],
  },
  {
    title: 'settings.legalSection',
    rows: [{ title: 'mobile.settings.about', value: () => version }],
  },
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
const router = useRouter();

async function refresh() {
  location.value = formatLatLon(readObserverLocation());
  try {
    setupCount.value = (await getGearSetups()).length;
  } catch (error) {
    reportError('SettingsPage.getGearSetups', error);
  }
  try {
    keyConfigured.value = (await loadServerSettings()).apiKeySet;
  } catch (error) {
    reportError('SettingsPage.loadServerSettings', error);
  }
}
onMounted(refresh);
onIonViewWillEnter(refresh);

// Ionic's own select, opened from the row; choosing a language applies it at once (the page reloads).
function onRow(row: RowDef, event: Event) {
  if (row.title === LANGUAGE_ROW) void select.value?.$el.open(event as UIEvent);
  else if (row.to) void router.push(row.to);
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
              :key="row.title"
              :title="t(row.title)"
              :value="row.title === LANGUAGE_ROW ? t(currentName) : row.value?.()"
              :inert="row.title !== LANGUAGE_ROW && !row.to"
              button
              chevron
              @click="onRow(row, $event)"
            >
              <template v-if="row.ok?.()" #trail>
                <span class="mob-status--success">{{ row.ok() }}</span>
              </template>
            </PhoneRow>
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
