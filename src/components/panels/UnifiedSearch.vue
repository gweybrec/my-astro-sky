<template>
  <div v-show="viewMode !== 'plans'" class="search-section">
    <div class="dso-search-wrapper">
      <input
        ref="searchInputEl"
        type="text"
        class="star-search-input"
        :placeholder="placeholder"
        :title="inputTitle"
        v-model="query"
        @input="onInput"
        @keydown="onKeydown"
        @blur="scheduleHideDropdown"
        @focus="onFocus"
      />
      <button class="search-clear-btn" :class="{ '!hidden': !query }" @click="onClear">
        &times;
      </button>
      <div
        v-if="viewMode === 'skymap' && showDropdown"
        class="search-dropdown !block"
        @mousedown.prevent
      >
        <div v-if="results.length === 0" class="search-item">
          <span class="search-item-name text-hint">{{ t('search.noResults') }}</span>
        </div>
        <template v-else>
          <div
            v-for="result in results"
            :key="result.type + ':' + (result.type === 'star' ? result.star?.hip : result.dso?.id)"
            class="search-item"
            @click="selectResult(result)"
          >
            <div class="search-item-top">
              <span :class="['search-item-type', result.type]">
                {{ result.type === 'star' ? t('search.typeStar') : t('search.typeDSO') }}
              </span>
              <span class="search-item-name">{{ result.label }}</span>
            </div>
            <div v-if="result.mag < 90" class="search-item-bottom">
              <span class="search-item-mag">mag {{ result.mag.toFixed(1) }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <StarInfoPanel v-if="viewMode === 'skymap' && selectedStar" :star="selectedStar" />

    <DSOInfoPanel
      v-if="viewMode === 'skymap' && selectedDSO"
      :dso="selectedDSO"
      @recenter="recenterDSO"
      @edit="editDSO"
    />

    <div v-if="viewMode === 'skymap' && nearbyStars.length > 0" class="dso-nearby-panel">
      <div class="dso-nearby-title">{{ t('stars.nearbyTitle') }}</div>
      <div
        v-for="star in nearbyStars"
        :key="star.hip"
        class="dso-nearby-star"
        @click="navigateToStar(star)"
      >
        {{ starDisplayName(star) }} (mag {{ star.mag.toFixed(1) }})
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { useUiStore } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';
import { searchUnified } from '../../search';
import type { UnifiedSearchResult } from '../../search';
import { getDSOById } from '../../dso-catalog';
import { getStars } from '../../star-catalog';
import { openDSOEditModal } from '../../dso-editor';
import {
  buildFallbackDSOResult,
  findChipDSOResult,
  normalizeChipKey,
  shouldApplyChipSearchResults,
} from '../../dso-chip-search';
import type { Star, DSO } from '../../types';
import type { StarSearchResult } from '../../api';
import {
  setDSOHighlight,
  setSelectDSOInSearchHandler,
  setClearDSOSelectionHandler,
  setFocusSearchInputHandler,
} from '../../ui';
import StarInfoPanel from './StarInfoPanel.vue';
import DSOInfoPanel from './DSOInfoPanel.vue';

const uiStore = useUiStore();
const canvasStore = useCanvasStore();

const searchInputEl = ref<HTMLInputElement | null>(null);
const query = ref('');
const results = ref<UnifiedSearchResult[]>([]);
const showDropdown = ref(false);
const selectedStar = ref<StarSearchResult | null>(null);
const selectedDSO = ref<DSO | null>(null);
const nearbyStars = ref<Star[]>([]);

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

const viewMode = computed(() => uiStore.currentViewMode);

const placeholder = computed(() =>
  viewMode.value === 'gallery' ? t('photos.searchPlaceholder') : t('search.placeholder'),
);
const inputTitle = computed(() =>
  viewMode.value === 'gallery' ? t('photos.searchTooltip') : t('search.tooltip'),
);

watch(viewMode, (mode, prev) => {
  showDropdown.value = false;
  if (mode === 'gallery') {
    selectedStar.value = null;
    selectedDSO.value = null;
    nearbyStars.value = [];
  } else if (mode === 'skymap' && prev === 'gallery') {
    canvasStore.gallery?.setSearchQuery('');
  }
});

function clearState(clearQuery: boolean) {
  if (clearQuery) query.value = '';
  results.value = [];
  showDropdown.value = false;
  selectedStar.value = null;
  selectedDSO.value = null;
  nearbyStars.value = [];
  canvasStore.skyMap?.setHighlightedStar(null);
  setDSOHighlight(null);
}

function onClear() {
  if (viewMode.value === 'gallery') {
    query.value = '';
    canvasStore.gallery?.setSearchQuery('');
    showDropdown.value = false;
    return;
  }
  clearState(true);
}

function onInput() {
  if (viewMode.value === 'gallery') {
    canvasStore.gallery?.setSearchQuery(query.value.toLowerCase().trim());
    showDropdown.value = false;
    return;
  }

  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const q = query.value;
    if (!q) {
      clearState(false);
      return;
    }
    const found = await searchUnified(q);
    if (query.value !== q) return;
    results.value = found;
    showDropdown.value = true;
  }, 250);
}

function onKeydown(e: KeyboardEvent) {
  if (viewMode.value !== 'skymap') return;
  if (e.key === 'Enter' && results.value.length > 0) {
    e.preventDefault();
    selectResult(results.value[0]);
  }
}

function scheduleHideDropdown() {
  setTimeout(() => {
    showDropdown.value = false;
  }, 200);
}

function onFocus() {
  if (query.value.length > 0) onInput();
}

function selectResult(result: UnifiedSearchResult) {
  const displayName = result.label.split(' – ')[0].split(' (')[0].trim();
  query.value = displayName;
  showDropdown.value = false;

  const skyMap = canvasStore.skyMap;
  if (!skyMap) return;

  // The searched object is always drawn via the highlight bypass (renderStars /
  // selectRenderedDSOs), so no magnitude override is needed to reveal a faint target.
  if (result.type === 'star') {
    setDSOHighlight(null);
    if (result.star) skyMap.setHighlightedStar(result.star.hip);
  } else if (result.type === 'dso' && result.dso) {
    skyMap.setShowDSOs(true);
    setDSOHighlight(result.dso.id);
    skyMap.setHighlightedStar(null);
  }

  const defaultScale = result.type === 'dso' ? 1200 : 800;
  skyMap.navigateTo(result.ra, result.dec, Math.max(skyMap.getView().scale, defaultScale));

  if (result.type === 'star' && result.star) {
    selectedStar.value = result.star;
    selectedDSO.value = null;
    loadNearbyStars(result.ra, result.dec);
  } else if (result.type === 'dso' && result.dso) {
    selectedDSO.value = result.dso;
    selectedStar.value = null;
    loadNearbyStars(result.ra, result.dec);
  }
}

async function selectDSOById(dsoId: string) {
  const chipKey = normalizeChipKey(dsoId);
  if (!chipKey) return;

  query.value = dsoId;
  const dsoFromCatalog = getDSOById(dsoId);

  try {
    const found = await searchUnified(dsoId);
    if (shouldApplyChipSearchResults(query.value, chipKey)) {
      results.value = found;
      const exact = findChipDSOResult(found, chipKey);
      if (exact) {
        selectResult(exact);
        return;
      }
    }
  } catch {
    // fall through to catalog fallback
  }

  if (dsoFromCatalog) {
    selectResult(buildFallbackDSOResult(dsoFromCatalog));
  }
}

function loadNearbyStars(ra: number, dec: number) {
  const toRad = Math.PI / 180;
  nearbyStars.value = getStars()
    .filter((s) => {
      if (s.mag > 6) return false;
      const d1 = dec * toRad;
      const d2 = s.dec * toRad;
      const dra = (s.ra - ra) * toRad;
      const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
      return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad <= 5;
    })
    .sort((a, b) => a.mag - b.mag)
    .slice(0, 5);
}

function starDisplayName(star: Star): string {
  if (star.name) return star.name;
  if (star.bayer && star.constellation) return `${star.bayer} ${star.constellation}`;
  if (star.flam && star.constellation) return `${star.flam} ${star.constellation}`;
  if (star.desig) return star.desig;
  return `HIP ${star.hip}`;
}

function navigateToStar(star: Star) {
  canvasStore.skyMap?.navigateTo(star.ra, star.dec, canvasStore.skyMap.getView().scale);
}

function recenterDSO() {
  if (selectedDSO.value) {
    const s = canvasStore.skyMap;
    s?.navigateTo(selectedDSO.value.ra, selectedDSO.value.dec, s.getView().scale);
  }
}

function editDSO() {
  if (!selectedDSO.value) return;
  const dso = selectedDSO.value;
  openDSOEditModal(dso, () => {
    const refreshed = getDSOById(dso.id);
    if (refreshed) selectedDSO.value = refreshed;
    canvasStore.skyMap?.render();
  });
}

onMounted(() => {
  setSelectDSOInSearchHandler(selectDSOById);
  setClearDSOSelectionHandler(() => clearState(true));
  setFocusSearchInputHandler(() => searchInputEl.value?.focus());
});

onUnmounted(() => {
  setSelectDSOInSearchHandler(() => {});
  setClearDSOSelectionHandler(() => {});
  setFocusSearchInputHandler(() => {});
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>
