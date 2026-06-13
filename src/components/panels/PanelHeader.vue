<template>
  <div class="panel-header">
    <button class="panel-settings-btn" :title="t('settings.modalTitle')" @click="openSettings">⚙</button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n';
import { openVueModal } from '../../modal-host';

const { t } = useI18n();

function openSettings() {
  openVueModal('settings');
}
</script>
