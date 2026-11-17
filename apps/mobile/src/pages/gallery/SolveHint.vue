<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { searchUnified, type UnifiedSearchResult } from '@myastrosky/core/search';
import { catalogsReady } from '../../catalogs';
import { solveHints, type SolveHint } from '../../pending-solve';
import AppIcon from '../../components/AppIcon.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import targetIcon from '@icons/target.svg?raw';

// The solve hint of a photo to add, as the desktop's: the target object (picked from the results of what is typed) and
// the field width. It is kept for the photo in `solveHints` and sent with its online solve; the target icon marks it
// here and after the title of each solve that sends it.
const props = defineProps<{ photoId: string; disabled?: boolean }>();

const hint = reactive<SolveHint>(
  solveHints.get(props.photoId) ?? { targetText: '', target: null, fov: '' },
);
solveHints.set(props.photoId, hint);

const results = ref<UnifiedSearchResult[]>([]);
let debounce: ReturnType<typeof setTimeout> | undefined;
const SEARCH_DELAY_MS = 250;
const MAX_RESULTS = 6;
/** The text set by picking a result: it is not searched again. */
let picked = hint.targetText;

watch(
  () => hint.targetText,
  (value) => {
    clearTimeout(debounce);
    const text = value.trim();
    if (value === picked) return;
    hint.target = null;
    if (!text) {
      results.value = [];
      return;
    }
    debounce = setTimeout(async () => {
      try {
        await catalogsReady();
        const found = await searchUnified(text, MAX_RESULTS);
        if (hint.targetText.trim() === text) results.value = found;
      } catch (error) {
        reportError('SolveHint.search', error);
      }
    }, SEARCH_DELAY_MS);
  },
);

function pick(result: UnifiedSearchResult) {
  picked = result.label;
  hint.targetText = result.label;
  hint.target = { ra: result.ra, dec: result.dec };
  results.value = [];
}
</script>

<template>
  <div class="solve-hint" :class="{ 'solve-hint--off': disabled }" data-test="solve-hint">
    <span class="phone-hint-mark phone-hint-mark--lg" aria-hidden="true"
      ><AppIcon :svg="targetIcon"
    /></span>
    <div>
      <PhoneField
        v-model="hint.targetText"
        bare
        :label="t('batch.hintTarget')"
        :placeholder="t('mobile.gallery.hintTargetPlaceholder')"
        :disabled="disabled"
      />
    </div>
    <div>
      <PhoneField
        v-model="hint.fov"
        bare
        :label="t('mobile.gallery.hintFovDeg')"
        :placeholder="t('batch.hintFovPlaceholder')"
        inputmode="decimal"
        :disabled="disabled"
      />
    </div>
  </div>
  <IonList v-if="results.length" class="mob-list" lines="none">
    <PhoneRow
      v-for="r in results"
      :key="r.label"
      :title="r.label"
      :subs="[`RA: ${r.ra.toFixed(2)}° Dec: ${r.dec.toFixed(2)}°`]"
      mono
      button
      @click="pick(r)"
    />
  </IonList>
</template>

<style scoped>
/* The card: the target icon, then the two fields (the object's wider), their boxes on one line under their labels. */
.solve-hint {
  display: grid;
  grid-template-columns: auto minmax(0, 7fr) minmax(0, 3fr);
  align-items: end;
  gap: var(--space-4);
  margin: 0 var(--mobile-gutter-end) var(--space-4) var(--mobile-gutter);
  padding: var(--space-4);
  border: 1px solid var(--accent-fill-lg);
  border-radius: var(--mobile-card-radius);
  background: var(--accent-fill-sm);
}
.solve-hint--off {
  opacity: 0.45;
}
</style>
