<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  defaultTimeWindow,
  formatAsteroidClass,
  formatCandidateName,
  type RankedCandidate,
} from '@myastrosky/core/asteroid-identify';
import {
  asteroidPixels,
  asteroidPois,
  asteroidSearchPlan,
  rankAsteroids,
} from '@myastrosky/core/photo-identify';
import { resolveCategory } from '@myastrosky/core/poi';
import { skybotConesearchAPI } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneCheckLeadRow from '../../components/PhoneCheckLeadRow.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneMarker from '../../components/PhoneMarker.vue';
import PhoneUtcDateTime from '../../components/PhoneUtcDateTime.vue';
import type { PhotoPoint } from '../../components/PhonePhotoStage.vue';
import IdentifyFrame from './IdentifyFrame.vue';
import IdentifySearching from './IdentifySearching.vue';
import { toggled, useIdentifyPage } from './identify-page';
import { useGrowingList } from '../../composables/useGrowingList';
import searchIcon from '../../icons/search.svg?raw';
import pinIcon from '@icons/supernova-pin.svg?raw';

// The boards "Identifier un astéroïde" and "Astéroïdes trouvés", as the desktop's AsteroidIdentifyModal: the start and
// the end of the trail are marked on the photo (a tap places the marker chosen by Départ or Arrivée, Départ first),
// with their times (UTC, from the photo's date and integration) and a search radius; IMCCE SkyBoT is asked for the
// asteroids that passed there, the best match ticked. In the results, one asteroid is the current one (its row
// highlighted, the best match first; tapping a row's text or ticking it makes it current): a tap on the photo moves its
// pin and ticks it, as the comets' page. "Modifier la recherche" goes back to the marks and the times.
const ASTEROID_CATEGORY_ID = 'cat-asteroid';
/** Rows drawn at a time in the list of asteroids found. */
const RESULTS_CHUNK = 20;

const { photo, shown, adding, close, add } = useIdentifyPage((p) => {
  const window = defaultTimeWindow(p);
  startIso.value = window?.startIso ?? '';
  endIso.value = window?.endIso ?? '';
});

const categories = usePoiCategoriesStore();
void categories.ensureLoaded();
const pinColor = computed(() => resolveCategory(ASTEROID_CATEGORY_ID, categories.categories).color);

type MarkerKey = 'start' | 'end';
const active = ref<MarkerKey>('start');
const startPx = ref<PhotoPoint | null>(null);
const endPx = ref<PhotoPoint | null>(null);
const startIso = ref('');
const endIso = ref('');
const radiusText = ref('5');

function onTap(p: PhotoPoint) {
  if (showResults.value) {
    moveCurrent(p);
    return;
  }
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
/** The asteroid whose pin a tap on the photo moves. */
const currentKey = ref<string | null>(null);
/** Pixels the user put an asteroid's pin on, by key: they win over the prediction. */
const moved = ref(new Map<string, PhotoPoint>());

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
  if (!shown.value || !startPx.value || !endPx.value || searching.value) return;
  searching.value = true;
  error.value = '';
  try {
    const plan = asteroidSearchPlan(
      shown.value,
      startPx.value,
      endPx.value,
      startIso.value,
      endIso.value,
      radius.value,
    );
    if (!plan) return;
    ranked.value = rankAsteroids(await skybotConesearchAPI(plan.params), plan);
    resetShown();
    // The best match is ticked, and the one a tap moves; the others are opt-in.
    const best = ranked.value.length ? key(ranked.value[0]) : null;
    selected.value = new Set(best ? [best] : []);
    currentKey.value = best;
    moved.value = new Map();
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

// ── The current asteroid and its pin ────────────────────────────────────────────────────────────

const current = computed(() => ranked.value?.find((c) => key(c) === currentKey.value) ?? null);

/** Ticking a row makes it the current one too: the asteroid last touched is the one the next tap moves. */
function tick(c: RankedCandidate, on: boolean) {
  selected.value = toggled(selected.value, key(c), on);
  if (on) currentKey.value = key(c);
}

function moveCurrent(p: PhotoPoint) {
  const k = currentKey.value;
  if (!k) return;
  moved.value = new Map(moved.value).set(k, p);
  selected.value = toggled(selected.value, k, true);
}

function reset(k: string) {
  const next = new Map(moved.value);
  next.delete(k);
  moved.value = next;
}

/** The pins drawn: the ticked asteroids', and the current one's (dimmed while it is not ticked). */
const pins = computed(() => {
  if (!ranked.value || !shown.value) return [];
  const drawn = ranked.value.filter(
    (c) => selected.value.has(key(c)) || key(c) === currentKey.value,
  );
  const predicted = asteroidPixels(shown.value, drawn) ?? [];
  return drawn.map((c, i) => ({
    key: key(c),
    at: moved.value.get(key(c)) ?? predicted[i],
    off: !selected.value.has(key(c)),
  }));
});

function addSelected() {
  if (!ranked.value || !shown.value) return;
  const chosen = ranked.value.filter((c) => selected.value.has(key(c)));
  void add(
    asteroidPois(shown.value, chosen, moved.value, key, ASTEROID_CATEGORY_ID),
    'asteroid.added',
  );
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
        <PhoneMarker
          :label="m.label"
          :text="letter(m.key)"
          :active="!showResults && active === m.key"
        />
      </div>
      <template v-if="showResults">
        <div
          v-for="p in pins"
          :key="p.key"
          class="mob-identify-anchor"
          :style="{ left: `${onScreen(p.at).x}px`, top: `${onScreen(p.at).y}px` }"
        >
          <span
            class="mob-pin"
            :class="{ 'mob-pin--off': p.off }"
            :style="{ '--poi-color': pinColor }"
            aria-hidden="true"
            ><AppIcon :svg="pinIcon"
          /></span>
        </div>
      </template>
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
        <span class="mob-unit m-body">{{ t('mobile.format.utc') }}</span>
      </div>
      <div class="mob-when-row">
        <PhoneButton
          :pressed="active === 'end'"
          :aria-label="t('mobile.identify.markEndAria')"
          @click="active = 'end'"
          >{{ t('asteroid.markEnd') }}</PhoneButton
        >
        <PhoneUtcDateTime v-model="endIso" :label="t('asteroid.markEnd')" />
        <span class="mob-unit m-body">{{ t('mobile.format.utc') }}</span>
      </div>
      <div class="mob-when-row mob-when-row--radius">
        <span class="mob-unit m-body">{{ t('mobile.identify.radius') }}</span>
        <PhoneField
          v-model="radiusText"
          bare
          inputmode="numeric"
          :aria-label="t('mobile.identify.radiusAria')"
        />
        <span class="mob-unit m-body">{{ t('mobile.format.arcmin') }}</span>
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
      <PhoneHelper v-if="current" small>{{
        t('mobile.identify.tapToAdjustAsteroid', { name: formatCandidateName(current) })
      }}</PhoneHelper>
      <div v-if="ranked?.length" class="mob-scroll mob-results-list" @scroll.passive="onScroll">
        <PhoneCheckLeadRow
          v-for="c in shownAsteroids"
          :key="key(c)"
          :model-value="selected.has(key(c))"
          :title="formatCandidateName(c)"
          :subs="[subLine(c)]"
          :warn="c.uncertainOrbit ? [t('asteroid.uncertainOrbit')] : []"
          :check-label="t('mobile.identify.keepAsPoi', { name: formatCandidateName(c) })"
          :current="currentKey === key(c)"
          button
          @update:model-value="tick(c, $event)"
          @open="currentKey = key(c)"
        >
          <!-- The first tap on the photo must not grow the panel, which would shrink the photo under the finger: the
               badge keeps its room while hidden, and "Revenir à la position prédite" is there from the start, disabled
               until the pin is moved. -->
          <template #badges>
            <span
              class="mob-badge mob-badge--type m-caption"
              :class="{ 'mob-invisible': !moved.has(key(c)) }"
              >{{ t('comet.adjusted') }}</span
            >
          </template>
          <template #actions>
            <PhoneButton :disabled="!moved.has(key(c))" @click="reset(key(c))">{{
              t('comet.resetPosition')
            }}</PhoneButton>
          </template>
        </PhoneCheckLeadRow>
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
