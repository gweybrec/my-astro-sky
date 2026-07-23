<template>
  <div v-show="viewMode === 'gallery'" class="gallery-filter-bar">
    <!-- Search input -->
    <div class="gallery-filter-search-wrap">
      <input
        ref="searchInputEl"
        type="text"
        class="gallery-filter-search-input"
        :placeholder="t('photos.searchPlaceholder')"
        v-model="searchQuery"
        @input="onSearchInput"
      />
      <button v-if="searchQuery" class="search-clear-btn" @click="clearSearch">&times;</button>
    </div>

    <!-- Setups dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="setupBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="setupOpen = !setupOpen"
      >
        {{ t('gallery.filterSetups')
        }}{{ selectedSetups.length > 0 ? ` (${selectedSetups.length})` : '' }}
      </button>
      <DropdownPanel v-model="setupOpen" :anchor-el="setupBtnRef" min-width="220px">
        <div class="labels-select-all-row justify-between">
          <span class="labels-select-all-label text-muted">{{
            selectedSetups.length === 0
              ? t('gallery.showingAll')
              : `${selectedSetups.length} ${t('gallery.selected')}`
          }}</span>
          <button
            type="button"
            class="bg-transparent border border-[var(--border-white-sm)] text-[var(--text-primary)] text-base rounded-sm cursor-pointer px-2 py-px hover:bg-[var(--accent-fill-sm)] disabled:opacity-40 disabled:cursor-default"
            :disabled="selectedSetups.length === 0"
            @click="clearSetups"
          >
            ✕ {{ t('display.clear') }}
          </button>
        </div>
        <div v-if="availableSetups.length === 0" class="px-6 py-3 text-muted text-base">—</div>
        <label
          v-for="item in availableSetups"
          :key="item.setupId"
          class="dso-toggle-label labels-select-all-row justify-between"
        >
          <div class="flex items-center">
            <input
              type="checkbox"
              :checked="selectedSetups.includes(item.setupId)"
              @change="(e) => toggleSetup(item.setupId, (e.target as HTMLInputElement).checked)"
            />
            <span class="tag-chip setup-chip tag-chip-sm ml-4">{{
              item.setupId === '(no setup)' ? t('display.noSetup') : item.name
            }}</span>
          </div>
          <span class="labels-count-span">{{ item.count }}</span>
        </label>
      </DropdownPanel>
      <button
        type="button"
        class="btn-icon shrink-0 self-stretch inline-flex items-center justify-center !py-0 !px-[var(--space-4)] leading-none"
        :title="t('gallery.batchEdit.gearTitleSetups')"
        @click.stop="batchEditMode = 'setup'"
      >
        ⚙
      </button>
    </div>

    <!-- Labels dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="labelBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="labelOpen = !labelOpen"
      >
        {{ t('gallery.filterLabels')
        }}{{ selectedLabels.length > 0 ? ` (${selectedLabels.length})` : '' }}
      </button>
      <DropdownPanel v-model="labelOpen" :anchor-el="labelBtnRef" min-width="220px">
        <div class="labels-select-all-row justify-between">
          <span class="labels-select-all-label text-muted">{{
            selectedLabels.length === 0
              ? t('gallery.showingAll')
              : `${selectedLabels.length} ${t('gallery.selected')}`
          }}</span>
          <button
            type="button"
            class="bg-transparent border border-[var(--border-white-sm)] text-[var(--text-primary)] text-base rounded-sm cursor-pointer px-2 py-px hover:bg-[var(--accent-fill-sm)] disabled:opacity-40 disabled:cursor-default"
            :disabled="selectedLabels.length === 0"
            @click="clearLabels"
          >
            ✕ {{ t('display.clear') }}
          </button>
        </div>
        <div v-if="availableLabels.length === 0" class="px-6 py-3 text-muted text-base">—</div>
        <label
          v-for="item in availableLabels"
          :key="item.label"
          class="dso-toggle-label labels-select-all-row justify-between"
        >
          <div class="flex items-center">
            <input
              type="checkbox"
              :checked="selectedLabels.includes(item.label)"
              @change="(e) => toggleLabel(item.label, (e.target as HTMLInputElement).checked)"
            />
            <span class="tag-chip label-chip tag-chip-sm ml-4">{{
              item.label === '(no label)' ? t('display.noLabel') : item.label
            }}</span>
          </div>
          <span class="labels-count-span">{{ item.count }}</span>
        </label>
      </DropdownPanel>
      <button
        type="button"
        class="btn-icon shrink-0 self-stretch inline-flex items-center justify-center !py-0 !px-[var(--space-4)] leading-none"
        :title="t('gallery.batchEdit.gearTitleLabels')"
        @click.stop="batchEditMode = 'label'"
      >
        ⚙
      </button>
    </div>

    <!-- Points of Interest dropdown (two-level: category → POI name) -->
    <PoiFilterDropdown
      :groups="poiGroups"
      :selected="selectedPois"
      @update:selected="onPoiUpdate"
      @open="refreshPois"
    />

    <!-- DSO types dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="typeBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="typeOpen = !typeOpen"
      >
        {{ t('gallery.filterTypes')
        }}{{ selectedTypes.length > 0 ? ` (${selectedTypes.length})` : '' }}
      </button>
      <DropdownPanel v-model="typeOpen" :anchor-el="typeBtnRef" min-width="240px">
        <div class="labels-select-all-row justify-between">
          <span class="labels-select-all-label text-muted">{{
            selectedTypes.length === 0
              ? t('gallery.showingAll')
              : `${selectedTypes.length} ${t('gallery.selected')}`
          }}</span>
          <button
            type="button"
            class="bg-transparent border border-[var(--border-white-sm)] text-[var(--text-primary)] text-base rounded-sm cursor-pointer px-2 py-px hover:bg-[var(--accent-fill-sm)] disabled:opacity-40 disabled:cursor-default"
            :disabled="selectedTypes.length === 0"
            @click="clearTypes"
          >
            ✕ {{ t('display.clear') }}
          </button>
        </div>
        <label
          v-for="type in DSO_TYPES_ALL"
          :key="type"
          class="dso-toggle-label labels-select-all-row"
        >
          <input
            type="checkbox"
            :checked="selectedTypes.includes(type)"
            @change="(e) => toggleType(type, (e.target as HTMLInputElement).checked)"
          />
          <span class="ml-4">{{ t(`dso.typeLabels.${type}`) }}</span>
        </label>
      </DropdownPanel>
    </div>

    <!-- Catalogs dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="catalogBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="catalogOpen = !catalogOpen"
      >
        {{ t('gallery.filterCatalogs')
        }}{{ selectedCatalogs.length > 0 ? ` (${selectedCatalogs.length})` : '' }}
      </button>
      <DropdownPanel v-model="catalogOpen" :anchor-el="catalogBtnRef" min-width="240px">
        <div class="labels-select-all-row justify-between">
          <span class="labels-select-all-label text-muted">{{
            selectedCatalogs.length === 0
              ? t('gallery.showingAll')
              : `${selectedCatalogs.length} ${t('gallery.selected')}`
          }}</span>
          <button
            type="button"
            class="bg-transparent border border-[var(--border-white-sm)] text-[var(--text-primary)] text-base rounded-sm cursor-pointer px-2 py-px hover:bg-[var(--accent-fill-sm)] disabled:opacity-40 disabled:cursor-default"
            :disabled="selectedCatalogs.length === 0"
            @click="clearCatalogs"
          >
            ✕ {{ t('display.clear') }}
          </button>
        </div>
        <label
          v-for="cat in DSO_CATALOGS_ALL"
          :key="cat"
          class="dso-toggle-label labels-select-all-row"
        >
          <input
            type="checkbox"
            :checked="selectedCatalogs.includes(cat)"
            @change="(e) => toggleCatalog(cat, (e.target as HTMLInputElement).checked)"
          />
          <span class="ml-4">{{ t(`dso.catalogLabels.${cat}`) }}</span>
        </label>
      </DropdownPanel>
    </div>

    <!-- Export -->
    <button
      type="button"
      class="display-controls-btn ml-auto inline-flex items-center gap-2"
      :title="t('settings.exportView.galleryPdf')"
      @click="onExport"
    >
      <span v-html="exportSvg" class="inline-flex w-4 h-4" />
      {{ t('settings.exportView.selection') }}
    </button>

    <!-- Batch label / setup editor (teleports to <body>, so it isn't clipped here) -->
    <BatchPhotoEditModal
      v-if="batchEditMode"
      :mode="batchEditMode"
      @close="batchEditMode = null"
      @saved="onBatchSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';
import { useI18n } from '../../composables/useI18n';
import { DSO_TYPES_ALL } from '../../display-settings';
import { DSO_CATALOGS_ALL } from '../../dso-catalog';
import DropdownPanel from '../base/DropdownPanel.vue';
import PoiFilterDropdown from './PoiFilterDropdown.vue';
import BatchPhotoEditModal from '../modals/BatchPhotoEditModal.vue';
import type { BatchEditMode } from '../../batch-photo-edit';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import {
  buildPoiFilterGroups,
  prunePoiSelection,
  poiSelectionsEqual,
  type PoiFilterGroup,
} from '../../poi';
import { showToast } from '../../toast';
import { getGearSetups } from '../../api';
import { downloadBlob } from '../../file-utils';
import { reportUnknownRendererError } from '../../error-reporter';
import exportSvg from '../../icons/export.svg?raw';

const { t } = useI18n();
const uiStore = useUiStore();
const canvasStore = useCanvasStore();
const poiCategoriesStore = usePoiCategoriesStore();

const viewMode = computed(() => uiStore.currentViewMode);

// ── Batch label / setup editor ────────────────────────────────────────────────
const batchEditMode = ref<BatchEditMode | null>(null);

// Labels/setups may have appeared or disappeared — rebuild both option lists so
// the dropdowns and their counts match what was just saved.
function onBatchSaved() {
  refreshLabels();
  void refreshSetups();
}

// ── Points of Interest (two-level) ─────────────────────────────────────────────
const poiGroups = ref<PoiFilterGroup[]>([]);
const selectedPois = ref<Map<string, Set<string>>>(new Map());

function refreshPois() {
  poiGroups.value = canvasStore.gallery?.getAllPois() ?? [];
  // Drop selections whose POIs/categories no longer exist so a stale filter can't
  // hide every photo; re-apply to the gallery only when something actually changed.
  const pruned = prunePoiSelection(selectedPois.value, poiGroups.value);
  if (!poiSelectionsEqual(pruned, selectedPois.value)) {
    selectedPois.value = pruned;
    canvasStore.gallery?.setPoiFilter(pruned.size > 0 ? pruned : null);
  }
}

function onPoiUpdate(next: Map<string, Set<string>>) {
  selectedPois.value = next;
  canvasStore.gallery?.setPoiFilter(next.size > 0 ? next : null);
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchInputEl = ref<HTMLInputElement>();
const searchQuery = ref('');

function onSearchInput() {
  canvasStore.gallery?.setSearchQuery(searchQuery.value);
}

function clearSearch() {
  searchQuery.value = '';
  canvasStore.gallery?.setSearchQuery('');
}

// ── Export (gallery contact sheet PDF) ─────────────────────────────────────────
async function onExport() {
  const photos = canvasStore.gallery?.getFilteredPhotos() ?? [];
  if (photos.length === 0) {
    showToast({ message: t('settings.exportView.empty'), type: 'error', duration: 3000 });
    return;
  }
  showToast({ message: t('settings.exportView.rendering'), type: 'info', duration: 2000 });
  try {
    const { renderGalleryPdf } = await import('../../export-render');
    const blob = await renderGalleryPdf(photos);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `myastrosky-gallery-${ts}.pdf`);
    showToast({ message: t('settings.exportView.success'), type: 'info', duration: 2500 });
  } catch (e) {
    reportUnknownRendererError('gallery_export_failed', e, { count: photos.length });
    showToast({ message: t('settings.exportView.error'), type: 'error', duration: 4000 });
  }
}

// ── Setups ────────────────────────────────────────────────────────────────────
const setupBtnRef = ref<HTMLButtonElement>();
const setupOpen = ref(false);
const availableSetups = ref<{ setupId: string; name: string; count: number }[]>([]);
const selectedSetups = ref<string[]>([]);

async function refreshSetups() {
  // Re-fetch so setups created since load appear; push into the gallery so chips resolve too.
  try {
    const setups = await getGearSetups();
    canvasStore.gallery?.setGearSetups(setups);
  } catch {
    /* keep whatever the gallery already has */
  }
  availableSetups.value = canvasStore.gallery?.getAllSetups() ?? [];
}

function toggleSetup(setupId: string, checked: boolean) {
  selectedSetups.value = checked
    ? [...selectedSetups.value, setupId]
    : selectedSetups.value.filter((s) => s !== setupId);
  canvasStore.gallery?.setSetupFilter(selectedSetups.value);
}

function clearSetups() {
  selectedSetups.value = [];
  canvasStore.gallery?.setSetupFilter(null);
}

watch(setupOpen, (open) => {
  if (open) void refreshSetups();
});

// ── Labels ────────────────────────────────────────────────────────────────────
const labelBtnRef = ref<HTMLButtonElement>();
const labelOpen = ref(false);
const availableLabels = ref<{ label: string; count: number }[]>([]);
const selectedLabels = ref<string[]>([]);

function refreshLabels() {
  availableLabels.value = canvasStore.gallery?.getAllLabels() ?? [];
}

function toggleLabel(label: string, checked: boolean) {
  selectedLabels.value = checked
    ? [...selectedLabels.value, label]
    : selectedLabels.value.filter((l) => l !== label);
  canvasStore.gallery?.setLabelFilter(selectedLabels.value);
}

function clearLabels() {
  selectedLabels.value = [];
  canvasStore.gallery?.setLabelFilter(null);
}

// DropdownPanel closes any other open dropdown itself, so we only refresh here.
watch(labelOpen, (open) => {
  if (open) refreshLabels();
});

// ── DSO Types ─────────────────────────────────────────────────────────────────
const typeBtnRef = ref<HTMLButtonElement>();
const typeOpen = ref(false);

const selectedTypes = ref<string[]>([]);

function toggleType(type: string, checked: boolean) {
  selectedTypes.value = checked
    ? [...selectedTypes.value, type]
    : selectedTypes.value.filter((t) => t !== type);
  canvasStore.gallery?.setDSOTypeFilter(selectedTypes.value);
}

function clearTypes() {
  selectedTypes.value = [];
  canvasStore.gallery?.setDSOTypeFilter([]);
}

// ── Catalogs ──────────────────────────────────────────────────────────────────
const catalogBtnRef = ref<HTMLButtonElement>();
const catalogOpen = ref(false);

const selectedCatalogs = ref<string[]>([]);

function toggleCatalog(cat: string, checked: boolean) {
  selectedCatalogs.value = checked
    ? [...selectedCatalogs.value, cat]
    : selectedCatalogs.value.filter((c) => c !== cat);
  canvasStore.gallery?.setDSOCatalogFilter(selectedCatalogs.value);
}

function clearCatalogs() {
  selectedCatalogs.value = [];
  canvasStore.gallery?.setDSOCatalogFilter([]);
}

// ── Init / reset filters on gallery entry/exit ────────────────────────────────
watch(viewMode, (mode) => {
  if (mode === 'gallery') {
    selectedSetups.value = [];
    selectedLabels.value = [];
    selectedTypes.value = [];
    selectedCatalogs.value = [];
    selectedPois.value = new Map();
    canvasStore.gallery?.setSetupFilter(null);
    canvasStore.gallery?.setLabelFilter(null);
    canvasStore.gallery?.setDSOTypeFilter([]);
    canvasStore.gallery?.setDSOCatalogFilter([]);
    canvasStore.gallery?.setPoiFilter(null);
    refreshLabels();
    void refreshSetups();
    poiCategoriesStore.ensureLoaded();
    refreshPois();
    return;
  }
  searchQuery.value = '';
  selectedSetups.value = [];
  selectedLabels.value = [];
  selectedTypes.value = [];
  selectedCatalogs.value = [];
  selectedPois.value = new Map();
  setupOpen.value = false;
  labelOpen.value = false;
  typeOpen.value = false;
  catalogOpen.value = false;
  batchEditMode.value = null;
  canvasStore.gallery?.setSearchQuery('');
  canvasStore.gallery?.setSetupFilter(null);
  canvasStore.gallery?.setLabelFilter(null);
  canvasStore.gallery?.setDSOTypeFilter([]);
  canvasStore.gallery?.setDSOCatalogFilter([]);
  canvasStore.gallery?.setPoiFilter(null);
});
</script>
