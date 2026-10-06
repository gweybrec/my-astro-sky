<template>
  <IdentifyModalShell
    :photo="photo"
    modal-class="supernova-identify-modal"
    :title="t('supernova.title')"
    :intro="t('supernova.intro')"
    :can-search="!!obsIso"
    :searching="searching"
    :error-message="searchErrorMessage"
    :selected-count="selected.size"
    @close="$emit('close')"
    @search="onSearch"
    @add="onAdd"
  >
    <template #labels>
      <label class="metadata-label">{{ t('identify.obsDateLabel') }}</label>
    </template>
    <!-- Split date/time inputs rather than datetime-local: these are literal UTC,
         while a native datetime-local (and its "Now" shortcut) is always local time. -->
    <template #inputs>
      <div class="flex gap-2">
        <input v-model="obsDateStr" type="date" class="dialog-input flex-[3_1_0%]" />
        <input v-model="obsTimeStr" type="time" class="dialog-input flex-[2_1_0%]" />
      </div>
    </template>
    <template #fields-hint>
      <div v-if="!obsIso" class="text-[var(--text-warning-sm)]">
        {{ t('identify.dateRequired') }}
      </div>
    </template>

    <!-- A starburst pin per candidate (same rays as the POI chip icon, no centre
         dot, so the transient itself stays visible). -->
    <template #markers="{ toDisplay }">
      <template v-for="c in results ?? []" :key="c.name">
        <span
          v-if="toDisplay(c)"
          class="absolute w-[28px] h-[28px] -ml-[14px] -mt-[14px] pointer-events-none transition-transform [&>svg]:w-full [&>svg]:h-full"
          :class="{ 'opacity-40': !selected.has(c.name), 'scale-150': hovered === c.name }"
          :style="{
            left: `${toDisplay(c)!.left}px`,
            top: `${toDisplay(c)!.top}px`,
            color: pinColor,
          }"
          v-html="pinSvg"
        ></span>
      </template>
    </template>

    <template #results>
      <div v-if="field?.truncated" class="text-hint">{{ t('supernova.fieldTruncated') }}</div>
      <div v-if="results !== null" class="flex flex-col gap-1">
        <div v-if="results.length === 0" class="text-hint">{{ t('supernova.noCandidates') }}</div>
        <label
          v-for="c in results"
          :key="c.name"
          class="flex items-start gap-3 py-2 px-3 border border-[var(--border-panel)] rounded-sm cursor-pointer"
          @mouseenter="hovered = c.name"
          @mouseleave="hovered = null"
        >
          <input
            type="checkbox"
            class="mt-1"
            :checked="selected.has(c.name)"
            @change="toggle(c.name, ($event.target as HTMLInputElement).checked)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ c.name }}</span>
              <span v-if="c.type" class="tag-chip-sm">{{ c.type }}</span>
              <span
                v-if="!c.classified"
                class="tag-chip-sm text-[var(--text-warning-sm)]"
                :title="t('supernova.unconfirmedHint')"
              >
                {{ t('supernova.unconfirmed') }}
              </span>
              <a
                :href="c.tnsUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="settings-link ml-auto text-small"
                @click.stop
                >{{ t('supernova.viewOnTns') }}</a
              >
            </div>
            <div class="text-hint text-small">
              {{ c.discoveryDate?.slice(0, 10) ?? '—' }} ·
              {{ formatDaysFromDiscovery(c.daysFromDiscovery) }} · {{ t('supernova.colMag') }}
              {{ c.discoveryMag?.toFixed(1) ?? '—' }}
              <template v-if="c.hostName">
                · {{ t('supernova.colHost') }} {{ c.hostName }}</template
              >
            </div>
          </div>
        </label>
      </div>
    </template>
  </IdentifyModalShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import IdentifyModalShell from './IdentifyModalShell.vue';
import { t } from '../../i18n';
import { computePhotoToProjMatrix } from '@myastrosky/core/photo-placement';
import { withCanonicalProjection } from '@myastrosky/core/projection';
import { tnsConesearchAPI } from '../../api';
import { isoToUtcParts, utcPartsToIso } from '@myastrosky/core/asteroid-identify';
import {
  photoFieldCircle,
  searchWindow,
  placeInImage,
  rankTransients,
  formatDaysFromDiscovery,
  candidateToPoi,
  SUPERNOVA_CATEGORY_ID,
  type FieldCircle,
  type PlacedTransient,
} from '@myastrosky/core/supernova-identify';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { resolveCategory } from '@myastrosky/core/poi';
import pinSvg from '../../icons/supernova-pin.svg?raw';
import type { Photo, PointOfInterest } from '@myastrosky/core/types';

const props = defineProps<{ photo: Photo }>();
// The modal never persists: the caller (PoiEditor.vue) pushes the POIs into its own
// v-model, like the asteroid and comet modals.
const emit = defineEmits<{ close: []; identified: [Photo, PointOfInterest[]] }>();

const categoriesStore = usePoiCategoriesStore();
void categoriesStore.ensureLoaded();
const pinColor = computed(
  () => resolveCategory(SUPERNOVA_CATEGORY_ID, categoriesStore.categories).color,
);

// ─── Observation date (authoritative ISO; the two inputs are a UTC view onto it) ──
const obsIso = ref(props.photo.observationDate ?? '');
const obsDateStr = computed({
  get: () => isoToUtcParts(obsIso.value).date,
  set: (v) => {
    obsIso.value = utcPartsToIso(v, isoToUtcParts(obsIso.value).time);
  },
});
const obsTimeStr = computed({
  get: () => isoToUtcParts(obsIso.value).time,
  set: (v) => {
    obsIso.value = utcPartsToIso(isoToUtcParts(obsIso.value).date, v);
  },
});

// ─── Search ─────────────────────────────────────────────────────────────────
const searching = ref(false);
const searchErrorMessage = ref('');
const field = ref<FieldCircle | null>(null);
const results = ref<PlacedTransient[] | null>(null);
const selected = ref(new Set<string>());
const hovered = ref<string | null>(null);

async function onSearch() {
  // Sky geometry runs in the canonical pole projection: the zenith-centred display
  // mode clips a field that is currently below the horizon (see
  // withCanonicalProjection), which would collapse the photo's fit.
  const fieldCircle = withCanonicalProjection(() => {
    const matrix = computePhotoToProjMatrix(props.photo);
    return matrix ? photoFieldCircle(matrix, props.photo.width, props.photo.height) : null;
  });
  const dateWindow = obsIso.value ? searchWindow(obsIso.value) : null;
  if (!fieldCircle || !dateWindow) return;
  searching.value = true;
  searchErrorMessage.value = '';
  results.value = null;
  try {
    field.value = fieldCircle;
    const candidates = await tnsConesearchAPI({
      raDeg: field.value.raDeg,
      decDeg: field.value.decDeg,
      radiusArcmin: field.value.radiusArcmin,
      ...dateWindow,
    });
    const placed = withCanonicalProjection(() => {
      const matrix = computePhotoToProjMatrix(props.photo);
      return matrix
        ? placeInImage(candidates, matrix, props.photo.width, props.photo.height, obsIso.value)
        : [];
    });
    results.value = rankTransients(placed);
    // Confirmed supernovae are pre-selected; unclassified transients are opt-in.
    selected.value = new Set(results.value.filter((c) => c.classified).map((c) => c.name));
  } catch (err) {
    searchErrorMessage.value = t('supernova.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

// One search on open when the date is already known — cached server-side, so
// re-opening the modal on the same photo doesn't hit TNS's rate limit again.
if (computePhotoToProjMatrix(props.photo) && obsIso.value) void onSearch();

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(name);
  else next.delete(name);
  selected.value = next;
}

function onAdd() {
  if (!results.value) return;
  const pois = results.value.filter((c) => selected.value.has(c.name)).map(candidateToPoi);
  emit('identified', props.photo, pois);
}
</script>
