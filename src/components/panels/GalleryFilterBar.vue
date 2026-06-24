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
      <button
        v-if="searchQuery"
        class="search-clear-btn"
        @click="clearSearch"
      >&times;</button>
    </div>

    <!-- Labels dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="labelBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="labelOpen = !labelOpen"
      >{{ t('gallery.filterLabels') }}{{ selectedLabels.length > 0 ? ` (${selectedLabels.length})` : '' }}</button>
      <DropdownPanel v-model="labelOpen" :anchor-el="labelBtnRef" min-width="220px">
        <label class="labels-select-all-row">
          <input
            ref="labelSelectAllRef"
            type="checkbox"
            :checked="allLabelsChecked"
            @change="toggleAllLabels"
          />
          <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
        </label>
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
            <span class="tag-chip label-chip tag-chip-sm ml-4">{{ item.label === '(no label)' ? t('display.noLabel') : item.label }}</span>
          </div>
          <span class="labels-count-span">{{ item.count }}</span>
        </label>
      </DropdownPanel>
    </div>

    <!-- Points of Interest dropdown (two-level: category → POI name) -->
    <PoiFilterDropdown
      :groups="poiGroups"
      :selected="selectedPois"
      @update:selected="onPoiUpdate"
    />

    <!-- DSO types dropdown -->
    <div class="display-controls-mag-row">
      <button
        ref="typeBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        @click.stop="typeOpen = !typeOpen"
      >{{ t('gallery.filterTypes') }}{{ selectedTypes.length > 0 ? ` (${selectedTypes.length})` : '' }}</button>
      <DropdownPanel v-model="typeOpen" :anchor-el="typeBtnRef" min-width="240px">
        <label class="labels-select-all-row">
          <input
            ref="typeSelectAllRef"
            type="checkbox"
            :checked="allTypesChecked"
            @change="toggleAllTypes"
          />
          <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
        </label>
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
      >{{ t('gallery.filterCatalogs') }}{{ selectedCatalogs.length > 0 ? ` (${selectedCatalogs.length})` : '' }}</button>
      <DropdownPanel v-model="catalogOpen" :anchor-el="catalogBtnRef" min-width="240px">
        <label class="labels-select-all-row">
          <input
            ref="catalogSelectAllRef"
            type="checkbox"
            :checked="allCatalogsChecked"
            @change="toggleAllCatalogs"
          />
          <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
        </label>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useUiStore } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';
import { useI18n } from '../../composables/useI18n';
import { DSO_TYPES_ALL } from '../../display-settings';
import { DSO_CATALOGS_ALL } from '../../dso-catalog';
import DropdownPanel from '../base/DropdownPanel.vue';
import PoiFilterDropdown from './PoiFilterDropdown.vue';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { buildPoiFilterGroups, type PoiFilterGroup } from '../../poi';
import { showToast } from '../../toast';
import { downloadBlob } from '../../file-utils';
import { renderGalleryPdf } from '../../export-render';
import { reportUnknownRendererError } from '../../error-reporter';
import exportSvg from '../../icons/export.svg?raw';

const { t } = useI18n();
const uiStore = useUiStore();
const canvasStore = useCanvasStore();
const poiCategoriesStore = usePoiCategoriesStore();

const viewMode = computed(() => uiStore.currentViewMode);

// ── Points of Interest (two-level) ─────────────────────────────────────────────
const poiGroups = ref<PoiFilterGroup[]>([]);
const selectedPois = ref<Map<string, Set<string>>>(new Map());

function refreshPois() {
  poiGroups.value = canvasStore.gallery?.getAllPois() ?? [];
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
    const blob = await renderGalleryPdf(photos);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `myastrosky-gallery-${ts}.pdf`);
    showToast({ message: t('settings.exportView.success'), type: 'info', duration: 2500 });
  } catch (e) {
    reportUnknownRendererError('gallery_export_failed', e, { count: photos.length });
    showToast({ message: t('settings.exportView.error'), type: 'error', duration: 4000 });
  }
}

// ── Labels ────────────────────────────────────────────────────────────────────
const labelBtnRef = ref<HTMLButtonElement>();
const labelSelectAllRef = ref<HTMLInputElement>();
const labelOpen = ref(false);
const availableLabels = ref<{ label: string; count: number }[]>([]);
const selectedLabels = ref<string[]>([]);
const labelsInitialized = ref(false);

const allLabelsChecked = computed(() =>
  availableLabels.value.length > 0 &&
  availableLabels.value.every(item => selectedLabels.value.includes(item.label))
);

const someLabelsChecked = computed(() =>
  availableLabels.value.some(item => selectedLabels.value.includes(item.label))
);

watch([allLabelsChecked, someLabelsChecked], () => {
  if (labelSelectAllRef.value) {
    labelSelectAllRef.value.indeterminate = someLabelsChecked.value && !allLabelsChecked.value;
  }
});

function refreshLabels() {
  const fresh = canvasStore.gallery?.getAllLabels() ?? [];
  if (!labelsInitialized.value && fresh.length > 0) {
    labelsInitialized.value = true;
    selectedLabels.value = fresh.map(i => i.label);
    canvasStore.gallery?.setLabelFilter(selectedLabels.value);
  }
  availableLabels.value = fresh;
}

function toggleLabel(label: string, checked: boolean) {
  selectedLabels.value = checked
    ? [...selectedLabels.value, label]
    : selectedLabels.value.filter(l => l !== label);
  canvasStore.gallery?.setLabelFilter(selectedLabels.value);
}

function toggleAllLabels(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  selectedLabels.value = checked ? availableLabels.value.map(i => i.label) : [];
  canvasStore.gallery?.setLabelFilter(selectedLabels.value);
}

watch(labelOpen, (open) => {
  if (open) { typeOpen.value = false; catalogOpen.value = false; refreshLabels(); }
});

function registerGalleryCallbacks() {
  const gallery = canvasStore.gallery;
  if (!gallery) return;
  gallery.onNewLabelsAppeared = (newLabels: string[]) => {
    const toAdd = newLabels.filter(l => !selectedLabels.value.includes(l));
    if (toAdd.length > 0) selectedLabels.value = [...selectedLabels.value, ...toAdd];
  };
}

onMounted(registerGalleryCallbacks);
watch(() => canvasStore.gallery, registerGalleryCallbacks);

// ── DSO Types ─────────────────────────────────────────────────────────────────
const typeBtnRef = ref<HTMLButtonElement>();
const typeSelectAllRef = ref<HTMLInputElement>();
const typeOpen = ref(false);
watch(typeOpen, (open) => { if (open) { labelOpen.value = false; catalogOpen.value = false; } });

const selectedTypes = ref<string[]>([...DSO_TYPES_ALL]);

const allTypesChecked = computed(() =>
  DSO_TYPES_ALL.every(t => selectedTypes.value.includes(t))
);

const someTypesChecked = computed(() =>
  DSO_TYPES_ALL.some(t => selectedTypes.value.includes(t))
);

watch([allTypesChecked, someTypesChecked], () => {
  if (typeSelectAllRef.value) {
    typeSelectAllRef.value.indeterminate = someTypesChecked.value && !allTypesChecked.value;
  }
});

function toggleType(type: string, checked: boolean) {
  selectedTypes.value = checked
    ? [...selectedTypes.value, type]
    : selectedTypes.value.filter(t => t !== type);
  canvasStore.gallery?.setDSOTypeFilter(selectedTypes.value);
}

function toggleAllTypes(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  selectedTypes.value = checked ? [...DSO_TYPES_ALL] : [];
  canvasStore.gallery?.setDSOTypeFilter(selectedTypes.value);
}

// ── Catalogs ──────────────────────────────────────────────────────────────────
const catalogBtnRef = ref<HTMLButtonElement>();
const catalogSelectAllRef = ref<HTMLInputElement>();
const catalogOpen = ref(false);
watch(catalogOpen, (open) => { if (open) { labelOpen.value = false; typeOpen.value = false; } });

const selectedCatalogs = ref<string[]>([...DSO_CATALOGS_ALL]);

const allCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.every(c => selectedCatalogs.value.includes(c))
);

const someCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.some(c => selectedCatalogs.value.includes(c))
);

watch([allCatalogsChecked, someCatalogsChecked], () => {
  if (catalogSelectAllRef.value) {
    catalogSelectAllRef.value.indeterminate = someCatalogsChecked.value && !allCatalogsChecked.value;
  }
});

function toggleCatalog(cat: string, checked: boolean) {
  selectedCatalogs.value = checked
    ? [...selectedCatalogs.value, cat]
    : selectedCatalogs.value.filter(c => c !== cat);
  canvasStore.gallery?.setDSOCatalogFilter(selectedCatalogs.value);
}

function toggleAllCatalogs(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  selectedCatalogs.value = checked ? [...DSO_CATALOGS_ALL] : [];
  canvasStore.gallery?.setDSOCatalogFilter(selectedCatalogs.value);
}

// ── Init / reset filters on gallery entry/exit ────────────────────────────────
watch(viewMode, (mode) => {
  if (mode === 'gallery') {
    selectedTypes.value = [...DSO_TYPES_ALL];
    selectedCatalogs.value = [...DSO_CATALOGS_ALL];
    refreshLabels();
    poiCategoriesStore.ensureLoaded();
    refreshPois();
    return;
  }
  searchQuery.value = '';
  selectedLabels.value = [];
  labelsInitialized.value = false;
  selectedTypes.value = [];
  selectedCatalogs.value = [];
  selectedPois.value = new Map();
  labelOpen.value = false;
  typeOpen.value = false;
  catalogOpen.value = false;
  canvasStore.gallery?.setSearchQuery('');
  canvasStore.gallery?.setLabelFilter(null);
  canvasStore.gallery?.setDSOTypeFilter([]);
  canvasStore.gallery?.setDSOCatalogFilter([]);
  canvasStore.gallery?.setPoiFilter(null);
});
</script>
