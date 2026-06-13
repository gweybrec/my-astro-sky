<template>
  <CollapsibleSection :title="t('dso.section')" :defaultOpen="false" v-model:open="displayStore.dsoSectionOpen">
    <CheckRow :label="t('dso.showDSOs')" :modelValue="displayStore.showDSOs" @update:modelValue="displayStore.setShowDSOs($event)" />

    <!-- Types dropdown -->
    <div class="display-controls-mag-row" :style="{ opacity: displayStore.showDSOs ? '1' : '0.4' }">
      <button
        ref="typeBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        :disabled="!displayStore.showDSOs"
        @click.stop="typeOpen = !typeOpen"
      >{{ t('gallery.filterTypes') }}{{ displayStore.dsoTypes.length > 0 ? ` (${displayStore.dsoTypes.length})` : '' }}</button>
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
    <div class="display-controls-mag-row" :style="{ opacity: displayStore.showDSOs ? '1' : '0.4' }">
      <button
        ref="catalogBtnRef"
        type="button"
        class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
        :disabled="!displayStore.showDSOs"
        @click.stop="catalogOpen = !catalogOpen"
      >{{ t('gallery.filterCatalogs') }}{{ displayStore.dsoCatalogs.length > 0 ? ` (${displayStore.dsoCatalogs.length})` : '' }}</button>
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
  </CollapsibleSection>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useDisplayStore } from '../../stores/display';
import { DSO_TYPES_ALL } from '../../display-settings';
import { DSO_CATALOGS_ALL } from '../../dso-catalog';
import { useI18n } from '../../composables/useI18n';
import CollapsibleSection from '../base/CollapsibleSection.vue';
import CheckRow from '../base/CheckRow.vue';
import DropdownPanel from '../base/DropdownPanel.vue';

const { t } = useI18n();
const displayStore = useDisplayStore();

// ── Types dropdown ─────────────────────────────────────────────────────────────
const typeBtnRef = ref<HTMLButtonElement>();
const typeSelectAllRef = ref<HTMLInputElement>();
const typeOpen = ref(false);

const allTypesChecked = computed(() => DSO_TYPES_ALL.every(ty => displayStore.dsoTypes.includes(ty)));
const someTypesChecked = computed(() => DSO_TYPES_ALL.some(ty => displayStore.dsoTypes.includes(ty)));

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
});;

function toggleType(type: string, checked: boolean) {
  const next = DSO_TYPES_ALL.filter(ty => ty === type ? checked : displayStore.dsoTypes.includes(ty));
  displayStore.setDsoTypes(next);
}

function toggleAllTypes(e: Event) {
  displayStore.setDsoTypes((e.target as HTMLInputElement).checked ? [...DSO_TYPES_ALL] : []);
}

// ── Catalogs dropdown ──────────────────────────────────────────────────────────
const catalogBtnRef = ref<HTMLButtonElement>();
const catalogSelectAllRef = ref<HTMLInputElement>();
const catalogOpen = ref(false);

const allCatalogsChecked = computed(() => DSO_CATALOGS_ALL.every(c => displayStore.dsoCatalogs.includes(c)));
const someCatalogsChecked = computed(() => DSO_CATALOGS_ALL.some(c => displayStore.dsoCatalogs.includes(c)));

watch([allCatalogsChecked, someCatalogsChecked], () => {
  if (catalogSelectAllRef.value) {
    catalogSelectAllRef.value.indeterminate = someCatalogsChecked.value && !allCatalogsChecked.value;
  }
});

watch(catalogOpen, (open) => {
  if (open) {
    typeOpen.value = false;
    nextTick(() => {
      if (catalogSelectAllRef.value)
        catalogSelectAllRef.value.indeterminate = someCatalogsChecked.value && !allCatalogsChecked.value;
    });
  }
});;

function toggleCatalog(cat: string, checked: boolean) {
  const next = DSO_CATALOGS_ALL.filter(c => c === cat ? checked : displayStore.dsoCatalogs.includes(c));
  displayStore.setDsoCatalogs(next);
}

function toggleAllCatalogs(e: Event) {
  displayStore.setDsoCatalogs((e.target as HTMLInputElement).checked ? [...DSO_CATALOGS_ALL] : []);
}
</script>
