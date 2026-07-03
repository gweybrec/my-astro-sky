<template>
  <BaseModal
    :title="t('settings.privacyTitle')"
    size="wide"
    body-class="modal-form-body--loose"
    @close="$emit('close')"
  >
    <p class="text-para">{{ t('settings.privacyLocal') }}</p>
    <div class="privacy-warning-block">
      <div class="privacy-warning-title">{{ t('settings.privacyException') }}</div>
      <p class="text-para">{{ t('settings.privacyAstrometry') }}</p>
    </div>
    <div v-if="isElectron" class="privacy-warning-block">
      <div class="privacy-warning-title">{{ t('settings.privacyExceptionGeoloc') }}</div>
      <p class="text-para">{{ t('settings.privacyGeoloc') }}</p>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from '../base/BaseModal.vue';
import { useI18n } from '../../composables/useI18n';

defineEmits<{ close: [] }>();

const { t } = useI18n();
const isElectron = !!(window as any).electronAPI;
</script>
