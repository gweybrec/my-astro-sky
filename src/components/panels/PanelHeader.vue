<template>
  <div class="panel-header">
    <button class="panel-settings-btn" :title="t('stats.title')" @click="openStats">🏆</button>
    <div class="flex gap-2">
      <button class="panel-settings-btn" :title="t('shortcuts.title')" @click="openShortcuts">
        ⌨
      </button>
      <button class="panel-settings-btn" :title="t('settings.modalTitle')" @click="openSettings">
        ⚙
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n';
import { openVueModal } from '../../modal-host';

const { t } = useI18n();

function openSettings() {
  openVueModal('settings');
}

function openShortcuts() {
  openVueModal('shortcuts');
}

function openStats() {
  openVueModal('stats');
}
</script>
