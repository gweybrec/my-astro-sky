<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  candidateToPoi,
  defaultTimeWindow,
  formatAsteroidClass,
  formatCandidateName,
  type RankedCandidate,
} from '@myastrosky/core/asteroid-identify';
import { asteroidSearchPlan, rankAsteroids } from '@myastrosky/core/photo-identify';
import { skybotConesearchAPI } from '@myastrosky/app-state/api';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneUtcDateTime from '../../components/PhoneUtcDateTime.vue';
import type { PhotoPoint } from '../../components/PhonePhotoStage.vue';
import IdentifyFrame from './IdentifyFrame.vue';
import IdentifySearching from './IdentifySearching.vue';
import { toggled, useIdentifyPage } from './identify-page';
import { useGrowingList } from '../../composables/useGrowingList';
import searchIcon from '../../icons/search.svg?raw';

// The boards "Identifier un astéroïde" and "Astéroïdes trouvés", as the desktop's AsteroidIdentifyModal: the start and
// the end of the trail are marked on the photo (a tap places the marker chosen by Départ or Arrivée, Départ first),
// with their times (UTC, from the photo's date and integration) and a search radius; IMCCE SkyBoT is asked for the
// asteroids that passed there, the best match ticked. "Modifier la recherche" goes back to the marks and the times.
const ASTEROID_CATEGORY_ID = 'cat-asteroid';
/** Rows drawn at a time in the list of asteroids found. */
const RESULTS_CHUNK = 20;

const { photo, adding, close, add } = useIdentifyPage((p) => {
  const window = defaultTimeWindow(p);
  startIso.value = window?.startIso ?? '';
  endIso.value = window?.endIso ?? '';
});

type MarkerKey = 'start' | 'end';
const active = ref<MarkerKey>('start');
const startPx = ref<PhotoPoint | null>(null);
const endPx = ref<PhotoPoint | null>(null);
const startIso = ref('');
const endIso = ref('');
const radiusText = ref('5');

function onTap(p: PhotoPoint) {
  if (active.value === 'start') {
    startPx.value = p;
    active.value = 'end';
  } else {
    endPx.value = p;
  }
}

const markers = computed(() => [
  ...(startPx.value
    ? [{ key: 'start', at: startPx.value, label: t('mobile.identify.startMarker') }]
    : []),
  ...(endPx.value ? [{ key: 'end', at: endPx.value, label: t('mobile.identify.endMarker') }] : []),
]);
/** The marker's letter: the first of its button's label (D and A, S and E…). */
const letter = (key: string) =>
  t(key === 'start' ? 'asteroid.markStart' : 'asteroid.markEnd').charAt(0);

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

const radius = computed(() => Number(radiusText.value.replace(',', '.')));
const searching = ref(false);
const error = ref('');
// SkyBoT can answer with thousands of asteroids on a field near the ecliptic (12,976 on a test photo): they are kept
// out of Vue's reactivity, and their rows are drawn a part at a time.
const ranked = shallowRef<RankedCandidate[] | null>(null);
const {
  shown: shownAsteroids,
  onScroll,
  reset: resetShown,
} = useGrowingList(() => ranked.value ?? [], RESULTS_CHUNK);
const selected = ref(new Set<string>());
const showResults = ref(false);

const canSearch = computed(
  () =>
    !!startPx.value &&
    !!endPx.value &&
    !!startIso.value &&
    !!endIso.value &&
    Number.isFinite(radius.value) &&
    radius.value > 0,
);
const key = (c: Pick<RankedCandidate, 'number' | 'name'>) => `${c.number ?? ''}|${c.name}`;

async function search() {
  if (!photo.value || !startPx.value || !endPx.value || searching.value) return;
  searching.value = true;
  error.value = '';
  try {
    const plan = asteroidSearchPlan(
      photo.value,
      startPx.value,
      endPx.value,
      startIso.value,
      endIso.value,
      radius.value,
    );
    if (!plan) return;
    ranked.value = rankAsteroids(await skybotConesearchAPI(plan.params), plan);
    resetShown();
    // The best match is ticked; the others are opt-in.
    selected.value = new Set(ranked.value.length ? [key(ranked.value[0])] : []);
    showResults.value = true;
  } catch (err) {
    error.value = t('asteroid.searchError', { message: (err as Error).message });
  } finally {
    searching.value = false;
  }
}

const found = computed(() => {
  const n = ranked.value?.length ?? 0;
  if (n === 0) return t('asteroid.noCandidates');
  return n === 1
    ? t('mobile.identify.asteroidsFoundOne')
    : t('mobile.identify.asteroidsFoundMany', { n });
});
const subLine = (c: RankedCandidate) =>
  [
    formatAsteroidClass(c.className),
    `${t('asteroid.colMag')} ${c.vMag?.toFixed(1) ?? '—'}`,
    `${t('asteroid.colError')} ${c.positionErrorArcsec.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(' · ');

function addSelected() {
  if (!ranked.value) return;
  const pois = ranked.value
    .filter((c) => selected.value.has(key(c)))
    .map((c) => candidateToPoi(c, ASTEROID_CATEGORY_ID));
  void add(pois, 'asteroid.added');
}
</script>

<template>
  <IdentifyFrame
    :title="t('asteroid.title')"
    :info="t('asteroid.intro')"
    :photo="photo"
    :results="showResults"
    :panel-label="
      showResults ? t('mobile.identify.asteroidsFound') : t('mobile.identify.asteroidSearch')
    "
    @tap="onTap"
  >
    <template #markers="{ onScreen }">
      <div
        v-for="m in markers"
        :key="m.key"
        class="mob-identify-anchor"
        :style="{ left: `${onScreen(m.at).x}px`, top: `${onScreen(m.at).y}px` }"
      >
        <span
          class="mob-marker"
          :class="{ 'mob-marker--active': !showResults && active === m.key }"
          role="img"
          :aria-label="m.label"
          ><span class="mob-marker-dot m-secondary">{{ letter(m.key) }}</span></span
        >
      </div>
    </template>

    <template v-if="!showResults">
      <div class="mob-when-row">
        <PhoneButton
          :pressed="active === 'start'"
          :aria-label="t('mobile.identify.markStartAria')"
          @click="active = 'start'"
          >{{ t('asteroid.markStart') }}</PhoneButton
        >
        <PhoneUtcDateTime v-model="startIso" :label="t('asteroid.markStart')" />
        <span class="mob-unit m-body">UTC</span>
      </div>
      <div class="mob-when-row">
        <PhoneButton
          :pressed="active === 'end'"
          :aria-label="t('mobile.identify.markEndAria')"
          @click="active = 'end'"
          >{{ t('asteroid.markEnd') }}</PhoneButton
        >
        <PhoneUtcDateTime v-model="endIso" :label="t('asteroid.markEnd')" />
        <span class="mob-unit m-body">UTC</span>
      </div>
      <div class="mob-when-row mob-when-row--radius">
        <span class="mob-unit m-body">{{ t('mobile.identify.radius') }}</span>
        <PhoneField
          v-model="radiusText"
          bare
          inputmode="numeric"
          :aria-label="t('mobile.identify.radiusAria')"
        />
        <span class="mob-unit m-body">arcmin</span>
        <PhoneButton
          variant="action"
          icon
          :aria-label="t('identify.search')"
          :disabled="!canSearch || searching"
          @click="search"
          ><AppIcon :svg="searchIcon"
        /></PhoneButton>
      </div>
      <PhoneHelper v-if="error" class="mob-status--danger">{{ error }}</PhoneHelper>
      <IdentifySearching v-else-if="searching" />
    </template>

    <template v-else>
      <PhoneHelper
        ><span :class="{ 'mob-status--success': ranked?.length }">{{ found }}</span></PhoneHelper
      >
      <div v-if="ranked?.length" class="mob-scroll mob-results-list" @scroll.passive="onScroll">
        <PhoneCheckRow
          v-for="c in shownAsteroids"
          :key="key(c)"
          :model-value="selected.has(key(c))"
          :title="formatCandidateName(c)"
          :subs="[subLine(c)]"
          :warn="c.uncertainOrbit ? [t('asteroid.uncertainOrbit')] : []"
          @update:model-value="selected = toggled(selected, key(c), $event)"
        />
      </div>
      <div class="mob-form-row mob-identify-edit">
        <PhoneButton @click="showResults = false">{{
          t('mobile.identify.editSearch')
        }}</PhoneButton>
      </div>
    </template>

    <template #footer>
      <div class="mob-sheet-footer mob-sheet-footer--primary-wide">
        <PhoneButton size="lg" @click="close">{{ t('modal.cancel') }}</PhoneButton>
        <PhoneButton
          variant="confirm"
          size="lg"
          :disabled="selected.size === 0 || !showResults || adding"
          @click="addSelected"
          >{{ t('identify.addSelected', { n: showResults ? selected.size : 0 }) }}</PhoneButton
        >
      </div>
    </template>
  </IdentifyFrame>
</template>
