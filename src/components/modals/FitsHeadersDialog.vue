<template>
  <div class="dialog-overlay" @click="$emit('close')">
    <div class="dialog !max-w-[720px]" role="dialog" aria-modal="true" @click.stop>
      <h3>{{ t('modal.fitsHeadersTitle') }}</h3>
      <input
        v-model="query"
        type="search"
        class="input-base mb-4"
        data-test="fits-headers-filter"
        :placeholder="t('modal.fitsHeadersFilter')"
        :aria-label="t('modal.fitsHeadersFilter')"
      />
      <div class="overflow-y-auto max-h-[60vh] mb-6">
        <p v-if="loading" class="dialog-message">…</p>
        <p v-else-if="shown.length === 0" class="dialog-message">
          {{ t('modal.fitsHeadersEmpty') }}
        </p>
        <table v-else class="dso-info-table">
          <tr v-for="(card, i) in shown" :key="i" data-test="fits-header-row">
            <td class="font-mono">{{ card.key }}</td>
            <td class="font-mono break-all pr-5">{{ card.value }}</td>
            <td>{{ card.comment ?? '' }}</td>
          </tr>
        </table>
      </div>
      <div class="dialog-buttons">
        <button ref="closeBtnEl" type="button" class="btn-confirm" @click="$emit('close')">
          {{ t('modal.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { filterFitsCards, type FitsCard } from '@myastrosky/core/fits-header';

/**
 * The raw header cards of the file a photo's data was read from, as written (keyword, value, comment), with a filter
 * on all three. The cards are given, or loaded when the dialog opens.
 */
const props = defineProps<{ cards: FitsCard[] | (() => Promise<FitsCard[]>) }>();
const emit = defineEmits<{ close: [] }>();

const all = ref<FitsCard[]>(Array.isArray(props.cards) ? props.cards : []);
const loading = ref(!Array.isArray(props.cards));
const query = ref('');

const shown = computed(() => filterFitsCards(all.value, query.value));

const closeBtnEl = ref<HTMLButtonElement | null>(null);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    emit('close');
  }
}

onMounted(async () => {
  // Capture phase: the editor below also closes on Escape.
  document.addEventListener('keydown', onKeyDown, true);
  closeBtnEl.value?.focus();
  if (!Array.isArray(props.cards)) {
    try {
      all.value = await props.cards();
    } catch {
      all.value = [];
    } finally {
      loading.value = false;
    }
  }
});
onUnmounted(() => document.removeEventListener('keydown', onKeyDown, true));
</script>
