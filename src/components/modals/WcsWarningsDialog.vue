<template>
  <div class="dialog-overlay" @click="$emit('cancel')">
    <div class="dialog !max-w-[480px]" role="dialog" aria-modal="true" @click.stop>
      <h3>{{ t('modal.wcsWarningsTitle') }}</h3>
      <p class="dialog-message">{{ t('modal.wcsWarningsIntro', { filename }) }}</p>
      <ul class="dialog-message !mb-6 pl-6 list-disc flex flex-col gap-2">
        <li v-for="(text, i) in warnings" :key="i" data-test="wcs-warning">{{ text }}</li>
      </ul>
      <div class="dialog-buttons">
        <button type="button" class="btn-cancel" @click="$emit('cancel')">
          {{ t('modal.cancel') }}
        </button>
        <button ref="continueBtnEl" type="button" class="btn-confirm" @click="$emit('continue')">
          {{ t('modal.wcsContinueAnyway') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';

/**
 * The reasons a solved/raw file may not be this photo's: the user goes on on purpose ("Continue anyway") or cancels,
 * and then nothing from the file is taken.
 */
defineProps<{ filename: string; warnings: string[] }>();
const emit = defineEmits<{ continue: []; cancel: [] }>();

const continueBtnEl = ref<HTMLButtonElement | null>(null);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    emit('cancel');
  }
}

onMounted(() => {
  // Capture phase: the editor below also closes on Escape.
  document.addEventListener('keydown', onKeyDown, true);
  continueBtnEl.value?.focus();
});
onUnmounted(() => document.removeEventListener('keydown', onKeyDown, true));
</script>
