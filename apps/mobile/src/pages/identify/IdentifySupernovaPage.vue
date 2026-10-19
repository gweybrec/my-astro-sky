<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { resolveCategory } from '@myastrosky/core/poi';
import { placeSupernovae, supernovaSearchPlan } from '@myastrosky/core/photo-identify';
import {
  candidateToPoi,
  formatDaysFromDiscovery,
  SUPERNOVA_CATEGORY_ID,
  type FieldCircle,
  type PlacedTransient,
} from '@myastrosky/core/supernova-identify';
import { tnsConesearchAPI } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneUtcDateTime from '../../components/PhoneUtcDateTime.vue';
import IdentifyFrame from './IdentifyFrame.vue';
import IdentifySearching from './IdentifySearching.vue';
import { toggled, useIdentifyPage } from './identify-page';
import searchIcon from '../../icons/search.svg?raw';
import pinIcon from '@icons/supernova-pin.svg?raw';

// The board "Identifier des supernovae", as the desktop's SupernovaIdentifyModal: the Transient Name Server is asked for
// the transients discovered in the photo's field up to a year before its observation date (UTC), each one found is
// pinned on the photo, confirmed supernovae first and ticked. It searches as the page opens when the photo has a date
// (TNS allows about two searches a minute; the answers are kept six hours).
const categories = usePoiCategoriesStore();
void categories.ensureLoaded();
const pinColor = computed(
  () => resolveCategory(SUPERNOVA_CATEGORY_ID, categories.categories).color,
);

const obsIso = ref('');
const { photo, adding, close, add } = useIdentifyPage((p) => {
  obsIso.value = p.observationDate ?? '';
  if (obsIso.value) void search();
});

const searching = ref(false);
const error = ref('');
const field = ref<FieldCircle | null>(null);
const results = ref<PlacedTransient[] | null>(null);
const selected = ref(new Set<string>());

async function search() {
  if (!photo.value || searching.value) return;
  const plan = supernovaSearchPlan(photo.value, obsIso.value);
  if (!plan) return;
  searching.value = true;
  error.value = '';
  results.value = null;
  try {
    field.value = plan.field;
    results.value = placeSupernovae(photo.value, await tnsConesearchAPI(plan.params), obsIso.value);
    // Confirmed supernovae are ticked; unclassified transients are opt-in.
    selected.value = new Set(results.value.filter((c) => c.classified).map((c) => c.name));
  } catch (err) {
    error.value = t('supernova.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

const subLine = (c: PlacedTransient) =>
  [
    c.discoveryDate?.slice(0, 10) ?? '—',
    formatDaysFromDiscovery(c.daysFromDiscovery),
    `${t('supernova.colMag')} ${c.discoveryMag?.toFixed(1) ?? '—'}`,
    ...(c.hostName ? [`${t('supernova.colHost')} ${c.hostName}`] : []),
  ].join(' · ');

function addSelected() {
  if (!results.value) return;
  void add(
    results.value.filter((c) => selected.value.has(c.name)).map(candidateToPoi),
    'supernova.added',
  );
}
</script>

<template>
  <IdentifyFrame
    :title="t('supernova.title')"
    :info="t('supernova.intro')"
    :photo="photo"
    results
    :panel-label="t('mobile.identify.supernovaeFound')"
  >
    <template #markers="{ onScreen }">
      <div
        v-for="c in results ?? []"
        :key="c.name"
        class="mob-identify-anchor"
        :style="{ left: `${onScreen(c).x}px`, top: `${onScreen(c).y}px` }"
      >
        <span
          class="mob-pin"
          :class="{ 'mob-pin--off': !selected.has(c.name) }"
          :style="{ '--poi-color': pinColor }"
          aria-hidden="true"
          ><AppIcon :svg="pinIcon"
        /></span>
      </div>
    </template>

    <div class="mob-form-row mob-form-row--search">
      <PhoneUtcDateTime v-model="obsIso" :label="t('identify.obsDateLabel')" />
      <span class="mob-unit m-body">UTC</span>
      <PhoneButton
        variant="action"
        icon
        :aria-label="t('identify.search')"
        :disabled="!obsIso || searching"
        @click="search"
        ><AppIcon :svg="searchIcon"
      /></PhoneButton>
    </div>
    <PhoneHelper v-if="!obsIso" class="mob-status--warn">{{
      t('identify.dateRequired')
    }}</PhoneHelper>
    <PhoneHelper v-else-if="error" class="mob-status--danger">{{ error }}</PhoneHelper>
    <IdentifySearching v-else-if="searching" />
    <PhoneHelper v-else-if="results?.length === 0">{{ t('supernova.noCandidates') }}</PhoneHelper>
    <PhoneHelper v-if="field?.truncated && results">{{
      t('supernova.fieldTruncated')
    }}</PhoneHelper>
    <div v-if="results?.length" class="mob-scroll mob-results-list">
      <PhoneCheckRow
        v-for="c in results"
        :key="c.name"
        :model-value="selected.has(c.name)"
        :title="c.name"
        :subs="[subLine(c)]"
        @update:model-value="selected = toggled(selected, c.name, $event)"
      >
        <template v-if="c.type || !c.classified" #badges>
          <span v-if="c.type" class="mob-badge mob-badge--type m-caption">{{ c.type }}</span>
          <span v-if="!c.classified" class="mob-badge mob-badge--warn m-caption">{{
            t('supernova.unconfirmed')
          }}</span>
        </template>
        <template #actions>
          <PhoneButton :href="c.tnsUrl" target="_blank" rel="noopener noreferrer">{{
            t('supernova.viewOnTns')
          }}</PhoneButton>
        </template>
      </PhoneCheckRow>
    </div>

    <template #footer>
      <div class="mob-sheet-footer mob-sheet-footer--primary-wide">
        <PhoneButton size="lg" @click="close">{{ t('modal.cancel') }}</PhoneButton>
        <PhoneButton
          variant="confirm"
          size="lg"
          :disabled="selected.size === 0 || !results || adding"
          @click="addSelected"
          >{{ t('identify.addSelected', { n: results ? selected.size : 0 }) }}</PhoneButton
        >
      </div>
    </template>
  </IdentifyFrame>
</template>
