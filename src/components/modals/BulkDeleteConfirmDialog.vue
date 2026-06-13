<template>
  <div class="dialog-overlay" @click="$emit('cancel')">
    <div class="dialog" @click.stop>
      <h3>{{ t('settings.deleteConfirmTitle') }}</h3>
      <ul class="mb-6 pl-8 text-base text-secondary list-disc">
        <li v-for="line in summaryLines" :key="line">{{ line }}</li>
      </ul>
      <p class="dialog-message text-[var(--status-error-text)]">
        {{ t('settings.deleteConfirmPermanent') }}
      </p>
      <div class="dialog-buttons">
        <button type="button" class="btn-cancel" @click="$emit('cancel')">{{ t('modal.cancel') }}</button>
        <button ref="confirmBtnEl" type="button" class="btn-danger" @click="$emit('confirm')">
          {{ t('settings.deleteAction') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';

defineProps<{ summaryLines: string[] }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const confirmBtnEl = ref<HTMLButtonElement | null>(null);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel'); }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
  confirmBtnEl.value?.focus();
});
onUnmounted(() => document.removeEventListener('keydown', onKeyDown));
</script>
