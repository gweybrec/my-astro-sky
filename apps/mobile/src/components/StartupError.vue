<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';

const props = defineProps<{
  message: string;
  /** Given when a database update failed: saves a full backup of the data, which the failed update left intact. */
  saveBackup?: () => Promise<void>;
}>();

// Starting again is a fresh page load: every start-up step runs again from the first.
const retry = () => location.reload();

const saving = ref(false);
const saveError = ref('');

async function save(): Promise<void> {
  if (!props.saveBackup) return;
  saving.value = true;
  saveError.value = '';
  try {
    await props.saveBackup();
  } catch (error) {
    console.error('Backup after a failed database update', error);
    saveError.value = t('mobile.startup.saveFailed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mob-startup-error">
    <div class="mob-startup-error-text">
      <template v-if="saveBackup">
        <p class="m-body-strong">{{ t('mobile.startup.updateFailed') }}</p>
        <p class="m-body">{{ t('mobile.startup.installUpdate') }}</p>
      </template>
      <p v-else class="m-body-strong">{{ t('mobile.startup.failed') }}</p>
      <p class="m-body">{{ message }}</p>
      <p v-if="saveError" class="m-body">{{ saveError }}</p>
    </div>
    <div class="mob-startup-error-buttons">
      <button
        v-if="saveBackup"
        type="button"
        class="mob-btn mob-btn--confirm mob-btn--lg m-body-strong"
        :disabled="saving"
        @click="save"
      >
        {{ t('mobile.startup.saveBackup') }}
      </button>
      <button
        type="button"
        class="mob-btn mob-btn--action mob-btn--lg m-body-strong"
        @click="retry"
      >
        {{ t('batch.retryButton') }}
      </button>
    </div>
  </div>
</template>

<style>
.mob-startup-error {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-7);
  padding: var(--mobile-gutter);
  background: var(--bg-app);
  color: var(--text-primary);
  text-align: center;
}

.mob-startup-error-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mob-startup-error-buttons {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
