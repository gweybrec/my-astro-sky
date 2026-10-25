<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';

defineProps<{ message: string }>();

// Starting again is a fresh page load: every start-up step runs again from the first.
const retry = () => location.reload();
</script>

<template>
  <div class="mob-startup-error">
    <div class="mob-startup-error-text">
      <p class="m-body-strong">{{ t('mobile.startup.failed') }}</p>
      <p class="m-body">{{ message }}</p>
    </div>
    <button type="button" class="mob-btn mob-btn--action mob-btn--lg m-body-strong" @click="retry">
      {{ t('batch.retryButton') }}
    </button>
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
</style>
