<template>
  <BaseModal :title="t('update.title')" body-class="modal-form-body--loose" modal-class="!w-fit !max-w-[90vw]" @close="dismiss">
    <p class="text-para">{{ t('update.body') }}</p>
    <div class="flex items-center justify-center gap-6 py-2">
      <div class="flex flex-col items-center gap-1">
        <span class="text-muted text-small uppercase tracking-wide">{{ t('update.currentLabel') }}</span>
        <span class="text-secondary text-body">{{ current }}</span>
      </div>
      <span class="text-dim text-large" aria-hidden="true">→</span>
      <div class="flex flex-col items-center gap-1">
        <span class="text-muted text-small uppercase tracking-wide">{{ t('update.latestLabel') }}</span>
        <span class="text-bright text-body font-medium">{{ latest }}</span>
      </div>
    </div>
    <template #footer>
      <button class="btn-cancel" @click="dismiss">{{ t('update.later') }}</button>
      <a
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="btn-action no-underline"
        @click="dismiss"
      >{{ t('update.viewRelease') }}</a>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { useI18n } from '../../composables/useI18n';
import { useUiStore } from '../../stores/ui';
import { DISMISSED_UPDATE_KEY } from '../../version-check';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const uiStore = useUiStore();

// Normalise to a single leading "v" so both versions display consistently
// (the running build's __APP_VERSION__ has no prefix; GitHub tags carry one).
const withV = (v: string) => (/^v/i.test(v) ? v : `v${v}`);
const current = withV(__APP_VERSION__);
const latest = computed(() => withV(uiStore.pendingUpdate?.latest ?? ''));
const url = computed(() => uiStore.pendingUpdate?.url || `https://github.com/gweybrec/my-astro-sky/releases`);

// Remember the announced version so it is not shown again on the next launch.
function dismiss() {
  if (uiStore.pendingUpdate) {
    try {
      localStorage.setItem(DISMISSED_UPDATE_KEY, uiStore.pendingUpdate.latest);
    } catch {
      // localStorage unavailable (private mode): non-fatal, just re-prompt next launch.
    }
  }
  emit('close');
}
</script>
