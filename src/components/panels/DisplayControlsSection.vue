<template>
  <CollapsibleSection :title="t('display.section')" :default-open="true">
    <!-- Show photos -->
    <CheckRow
      :label="t('display.showPhotos')"
      :model-value="displayStore.showPhotos"
      @update:model-value="displayStore.setShowPhotos"
    />

    <!-- Labels dropdown (must be first after show-photos, per original DOM insertion order) -->
    <LabelsDropdown />

    <!-- Points of Interest filter (two-level: category → POI name) -->
    <SkyPoiDropdown />

    <!-- Show DSOs -->
    <CheckRow
      :label="t('dso.showDSOs')"
      :model-value="displayStore.showDSOs"
      @update:model-value="displayStore.setShowDSOs($event)"
    />

    <!-- Types dropdown -->
    <div class="display-controls-mag-row" :class="{ 'opacity-40': !displayStore.showDSOs }">
      <button
        ref="typeBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        :disabled="!displayStore.showDSOs"
        @click.stop="typeOpen = !typeOpen"
      >
        {{ t('gallery.filterTypes')
        }}{{ displayStore.dsoTypes.length > 0 ? ` (${displayStore.dsoTypes.length})` : '' }}
      </button>
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
            :checked="displayStore.dsoTypes.includes(type)"
            @change="(e) => toggleType(type, (e.target as HTMLInputElement).checked)"
          />
          <span class="ml-4">{{ t(`dso.typeLabels.${type}`) }}</span>
        </label>
      </DropdownPanel>
    </div>

    <!-- Catalogs dropdown -->
    <div class="display-controls-mag-row" :class="{ 'opacity-40': !displayStore.showDSOs }">
      <button
        ref="catalogBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        :disabled="!displayStore.showDSOs"
        @click.stop="catalogOpen = !catalogOpen"
      >
        {{ t('gallery.filterCatalogs')
        }}{{ displayStore.dsoCatalogs.length > 0 ? ` (${displayStore.dsoCatalogs.length})` : '' }}
      </button>
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
            :checked="displayStore.dsoCatalogs.includes(cat)"
            @change="(e) => toggleCatalog(cat, (e.target as HTMLInputElement).checked)"
          />
          <span class="ml-4">{{ t(`dso.catalogLabels.${cat}`) }}</span>
        </label>
      </DropdownPanel>
    </div>

    <!-- Hemisphere picker -->
    <div class="display-controls-mag-row hemisphere-row">
      <span class="display-controls-mag-label flex-1">{{ t('display.hemisphere') }}</span>
      <div class="hemisphere-pill">
        <button
          class="hemisphere-btn"
          :class="{ 'hemisphere-btn--active': displayStore.hemisphere === 'north' }"
          @click="displayStore.setHemisphere('north')"
        >
          {{ t('display.hemisphereNorth') }}
        </button>
        <button
          class="hemisphere-btn"
          :class="{ 'hemisphere-btn--active': displayStore.hemisphere === 'south' }"
          @click="displayStore.setHemisphere('south')"
        >
          {{ t('display.hemisphereSouth') }}
        </button>
      </div>
    </div>

    <!-- Fisheye projection toggle -->
    <div class="display-controls-mag-row hemisphere-row">
      <span class="display-controls-mag-label flex-1">{{ t('display.fisheye') }}</span>
      <div class="hemisphere-pill">
        <button
          class="hemisphere-btn"
          :class="{ 'hemisphere-btn--active': !fisheyeStore.active }"
          @click="fisheyeStore.setActive(false)"
        >
          {{ t('display.projStereo') }}
        </button>
        <button
          class="hemisphere-btn"
          :class="{ 'hemisphere-btn--active': fisheyeStore.active }"
          @click="fisheyeStore.setActive(true)"
        >
          {{ t('display.projFisheye') }}
        </button>
      </div>
    </div>

    <!-- Border latitude slider -->
    <div class="display-controls-mag-row mt-6 mb-3">
      <label
        class="display-controls-mag-label border-slider-label"
        :title="t('display.borderLatTooltip')"
      >
        {{ t('display.borderLatDeg') }}
      </label>
      <input
        type="range"
        min="0"
        max="90"
        step="1"
        class="display-controls-mag-slider flex-1 min-w-[60px]"
        :value="displayStore.borderLatDeg"
        @input="onBorderLatInput"
      />
      <span class="border-slider-value">{{ displayStore.borderLatDeg }}°</span>
    </div>

    <!-- Checkboxes -->
    <CheckRow
      :label="t('display.showStars')"
      :model-value="displayStore.showStars"
      @update:model-value="displayStore.setShowStars"
    />
    <CheckRow
      :label="t('display.constellationLines')"
      :model-value="displayStore.showConstellationLines"
      @update:model-value="displayStore.setShowConstellationLines"
    />
    <CheckRow
      :label="t('display.constellationNames')"
      :model-value="namesChecked"
      :disabled="!isIAUStyle(displayStore.constellationStyle)"
      @update:model-value="displayStore.setShowConstellationNames"
    />

    <!-- Constellation style select -->
    <div class="display-controls-mag-row mb-3 items-center gap-4">
      <span class="display-controls-mag-label">{{ t('display.constellationStyle') }}</span>
      <select
        class="display-controls-select"
        :value="displayStore.constellationStyle"
        @change="onStyleChange"
      >
        <option value="western">{{ t('display.constellationStyleWestern') }}</option>
        <option value="stellarium">{{ t('display.constellationStyleStellarium') }}</option>
        <option value="rey">{{ t('display.constellationStyleRey') }}</option>
        <option value="chinese">{{ t('display.constellationStyleChinese') }}</option>
        <option value="arabic">{{ t('display.constellationStyleArabic') }}</option>
      </select>
    </div>

    <CheckRow
      :label="t('display.starLabels')"
      :model-value="displayStore.showStarLabels"
      @update:model-value="displayStore.setShowStarLabels"
    />
    <CheckRow
      :label="t('display.dsoLabels')"
      :model-value="displayStore.showDSOLabels"
      @update:model-value="displayStore.setShowDSOLabels"
    />
    <CheckRow
      :label="t('display.raDecGrid')"
      :model-value="displayStore.showGrid"
      @update:model-value="displayStore.setShowGrid"
    />
    <CheckRow
      :label="t('display.photoOutlines')"
      :model-value="displayStore.showPhotoOutlines"
      @update:model-value="displayStore.setShowPhotoOutlines"
    />

    <!-- Opacity sliders -->
    <SliderRow
      :label="t('display.skyOpacity')"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="displayStore.skyOpacity"
      @update:model-value="displayStore.setSkyOpacity"
    />
    <SliderRow
      :label="t('display.backgroundGradient')"
      :min="0"
      :max="1"
      :step="0.05"
      :model-value="displayStore.backgroundOpacity"
      @update:model-value="displayStore.setBackgroundOpacity"
    />

    <!-- Tooltip toggles -->
    <CheckRow
      :label="t('display.showStarTooltips')"
      :model-value="displayStore.showStarTooltips"
      @update:model-value="displayStore.setShowStarTooltips"
    />
    <CheckRow
      :label="t('display.showDSOTooltips')"
      :model-value="displayStore.showDSOTooltips"
      @update:model-value="displayStore.setShowDSOTooltips"
    />
    <CheckRow
      :label="t('display.simplifiedDSOTooltips')"
      :model-value="displayStore.simplifiedDSOTooltips"
      @update:model-value="displayStore.setSimplifiedDSOTooltips"
    />
  </CollapsibleSection>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import CollapsibleSection from '../base/CollapsibleSection.vue';
import SliderRow from '../base/SliderRow.vue';
import CheckRow from '../base/CheckRow.vue';
import DropdownPanel from '../base/DropdownPanel.vue';
import LabelsDropdown from './LabelsDropdown.vue';
import SkyPoiDropdown from './SkyPoiDropdown.vue';
import { useDisplayStore } from '../../stores/display';
import { useFisheyeStore } from '../../stores/fisheye';
import { useI18n } from '../../composables/useI18n';
import { isIAUStyle } from '../../types';
import type { ConstellationStyle } from '../../types';
import { DSO_TYPES_ALL } from '../../display-settings';
import { DSO_CATALOGS_ALL } from '../../dso-catalog';

const { t } = useI18n();
const displayStore = useDisplayStore();
const fisheyeStore = useFisheyeStore();

const namesChecked = computed(() =>
  isIAUStyle(displayStore.constellationStyle) ? displayStore.showConstellationNames : false,
);

function onBorderLatInput(e: Event) {
  displayStore.setBorderLatDeg(parseInt((e.target as HTMLInputElement).value));
}

async function onStyleChange(e: Event) {
  const style = (e.target as HTMLSelectElement).value as ConstellationStyle;
  await displayStore.setConstellationStyle(style);
}

// ── Types dropdown ─────────────────────────────────────────────────────────────
const typeBtnRef = ref<HTMLButtonElement>();
const typeSelectAllRef = ref<HTMLInputElement>();
const typeOpen = ref(false);

const allTypesChecked = computed(() =>
  DSO_TYPES_ALL.every((ty) => displayStore.dsoTypes.includes(ty)),
);
const someTypesChecked = computed(() =>
  DSO_TYPES_ALL.some((ty) => displayStore.dsoTypes.includes(ty)),
);

watch([allTypesChecked, someTypesChecked], () => {
  if (typeSelectAllRef.value) {
    typeSelectAllRef.value.indeterminate = someTypesChecked.value && !allTypesChecked.value;
  }
});

watch(typeOpen, (open) => {
  if (open) {
    catalogOpen.value = false;
    nextTick(() => {
      if (typeSelectAllRef.value)
        typeSelectAllRef.value.indeterminate = someTypesChecked.value && !allTypesChecked.value;
    });
  }
});

function toggleType(type: string, checked: boolean) {
  const next = DSO_TYPES_ALL.filter((ty) =>
    ty === type ? checked : displayStore.dsoTypes.includes(ty),
  );
  displayStore.setDsoTypes(next);
}

function toggleAllTypes(e: Event) {
  displayStore.setDsoTypes((e.target as HTMLInputElement).checked ? [...DSO_TYPES_ALL] : []);
}

// ── Catalogs dropdown ──────────────────────────────────────────────────────────
const catalogBtnRef = ref<HTMLButtonElement>();
const catalogSelectAllRef = ref<HTMLInputElement>();
const catalogOpen = ref(false);

const allCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.every((c) => displayStore.dsoCatalogs.includes(c)),
);
const someCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.some((c) => displayStore.dsoCatalogs.includes(c)),
);

watch([allCatalogsChecked, someCatalogsChecked], () => {
  if (catalogSelectAllRef.value) {
    catalogSelectAllRef.value.indeterminate =
      someCatalogsChecked.value && !allCatalogsChecked.value;
  }
});

watch(catalogOpen, (open) => {
  if (open) {
    typeOpen.value = false;
    nextTick(() => {
      if (catalogSelectAllRef.value)
        catalogSelectAllRef.value.indeterminate =
          someCatalogsChecked.value && !allCatalogsChecked.value;
    });
  }
});

function toggleCatalog(cat: string, checked: boolean) {
  const next = DSO_CATALOGS_ALL.filter((c) =>
    c === cat ? checked : displayStore.dsoCatalogs.includes(c),
  );
  displayStore.setDsoCatalogs(next);
}

function toggleAllCatalogs(e: Event) {
  displayStore.setDsoCatalogs((e.target as HTMLInputElement).checked ? [...DSO_CATALOGS_ALL] : []);
}
</script>
