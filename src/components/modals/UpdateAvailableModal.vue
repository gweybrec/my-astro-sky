<template>
  <BaseModal :title="t('update.title')" @close="dismiss">
    <p class="text-para">{{ t('update.body') }}</p>
    <div class="about-meta-block">
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[64px]">{{ t('update.currentLabel') }}</span>
        {{ current }}
      </div>
      <div class="about-meta-row">
        <span class="text-muted inline-block min-w-[64px]">{{ t('update.latestLabel') }}</span>
        {{ latest }}
      </div>
    </div>
    <template #footer>
      <button class="display-controls-btn" @click="dismiss">{{ t('update.later') }}</button>
      <a
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="btn-primary"
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

const current = __APP_VERSION__;
const latest = computed(() => uiStore.pendingUpdate?.latest ?? '');
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
