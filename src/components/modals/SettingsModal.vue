<template>
  <BaseModal :title="t('settings.modalTitle')" size="wide" body-class="modal-form-body" @close="$emit('close')">

    <!-- Appearance -->
    <div class="settings-section-label">{{ t('settings.appearanceSection') }}</div>
    <div class="settings-fields-row">
      <div class="settings-field">
        <label class="settings-field-label">{{ t('settings.languageLabel') }}</label>
        <select class="settings-field-input" :value="currentLang" @change="onLangChange">
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="de">Deutsch</option>
        </select>
      </div>
      <div class="settings-field">
        <label class="settings-field-label">{{ t('settings.themeLabel') }}</label>
        <select class="settings-field-input" v-model="selectedTheme" @change="onThemeChange">
          <option value="cold-blue-v2">{{ t('settings.themeColdBlueV2') }}</option>
          <option value="warm">{{ t('settings.themeWarm') }}</option>
          <option value="cold-blue">{{ t('settings.themeColdBlue') }}</option>
        </select>
      </div>
    </div>

    <hr class="settings-separator">

    <!-- Import / Export -->
    <div class="settings-section-label">{{ t('settings.importExportLabel') }}</div>
    <div class="settings-io-btns">
      <button class="btn-action" @click="onExport">{{ t('settings.exportBtn') }}</button>
      <button class="btn-action" @click="onImport">{{ t('settings.importData') }}</button>
    </div>

    <hr class="settings-separator">

    <!-- Solver / API -->
    <div class="settings-section-label">{{ t('settings.solverSection') }}</div>
    <button class="btn-action btn-action--full" @click="openSolverSettings">{{ t('settings.openSolverSettings') }}</button>

    <hr class="settings-separator">

    <!-- Legal -->
    <div class="settings-section-label">{{ t('settings.legalSection') }}</div>
    <button class="settings-legal-btn" @click="onLegal('about')">
      <span v-html="aboutSvg" />
      <span>{{ t('settings.aboutBtn') }}</span>
    </button>
    <button class="settings-legal-btn" @click="onLegal('privacy')">
      <span v-html="privacySvg" />
      <span>{{ t('settings.privacyBtn') }}</span>
    </button>
    <button class="settings-legal-btn" @click="onLegal('credits')">
      <span v-html="creditsSvg" />
      <span>{{ t('settings.dataCreditsBtn') }}</span>
    </button>

    <hr class="settings-separator">

    <!-- Diagnostics -->
    <div class="settings-section-label">{{ t('settings.diagnosticsSection') }}</div>
    <div class="settings-mono-hint">{{ logsPathHint }}</div>
    <button class="btn-action btn-action--full" :disabled="!logsAvailable" :title="logsAvailable ? '' : t('settings.openLogsFolderUnavailable')" @click="onOpenLogs">
      {{ t('settings.openLogsFolder') }}
    </button>

    <hr class="settings-separator">

    <!-- Danger zone -->
    <div class="settings-section-label settings-danger-label">{{ t('settings.dangerSection') }}</div>
    <button class="btn-danger w-full" @click="onDeleteAll">{{ t('settings.deleteAllBtn') }}</button>

  </BaseModal>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../composables/useI18n';
import { openVueModal } from '../../modal-host';
import { showToast } from '../../toast';
import aboutSvg from '../../icons/about.svg?raw';
import privacySvg from '../../icons/privacy.svg?raw';
import creditsSvg from '../../icons/credits.svg?raw';
import { loadTheme, applyTheme, type Theme } from '../../theme';
import type { Lang } from '../../i18n';

const emit = defineEmits<{ close: [] }>();
const { t, lang: currentLang, setLang } = useI18n();
const settingsStore = useSettingsStore();

// Language
function onLangChange(e: Event) { setLang((e.target as HTMLSelectElement).value as Lang); }

// Theme
const selectedTheme = ref<Theme>(loadTheme());
function onThemeChange() { applyTheme(selectedTheme.value); }

const logsPathHint = ref(t('settings.logsPathHintLoading'));
const logsAvailable = ref(false);

onMounted(async () => {
  if (window.myAstroDiagnostics?.getLogsPathHint) {
    logsAvailable.value = true;
    logsPathHint.value = t('settings.logsPathLabel') + ' ' +
      await window.myAstroDiagnostics.getLogsPathHint().catch(() => t('settings.logsPathUnavailable'));
  } else {
    logsPathHint.value = t('settings.logsPathUnavailable');
  }
});

async function onOpenLogs() {
  if (!window.myAstroDiagnostics?.openLogsDir) {
    showToast({ message: t('settings.openLogsFolderUnavailable'), type: 'error' });
    return;
  }
  const result = await window.myAstroDiagnostics.openLogsDir();
  if (!result.ok) {
    showToast({ message: result.message || t('settings.openLogsFolderError'), type: 'error' });
  } else {
    showToast({ message: t('settings.openLogsFolderSuccess'), type: 'info', duration: 2500 });
  }
}

function onLegal(name: 'about' | 'privacy' | 'credits') {
  openVueModal(name);
}

function onExport() {
  openVueModal('export');
}

function onImport() {
  openVueModal('import');
}

function onDeleteAll() {
  openVueModal('deleteAll');
}

function openSolverSettings() {
  openVueModal('solverSettings');
}
</script>
