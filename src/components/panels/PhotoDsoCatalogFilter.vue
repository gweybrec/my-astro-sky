<template>
  <div v-if="modelValue" class="display-controls-mag-row gallery-dso-catalog-row">
    <button
      ref="catalogBtnRef"
      type="button"
      class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
      @click.stop="catalogOpen = !catalogOpen"
    >
      {{ t('gallery.filterCatalogs') }}{{ catalogs.length > 0 ? ` (${catalogs.length})` : '' }}
    </button>
    <DropdownPanel
      v-model="catalogOpen"
      :anchor-el="catalogBtnRef"
      min-width="240px"
      panel-class="gallery-dso-catalog-dropdown"
    >
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
          :checked="catalogs.includes(cat)"
          @change="(e) => toggleCatalog(cat, (e.target as HTMLInputElement).checked)"
        />
        <span class="ml-4">{{ t(`dso.catalogLabels.${cat}`) }}</span>
      </label>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { DSO_CATALOGS_ALL } from '../../dso-catalog';
import { useI18n } from '../../composables/useI18n';
import DropdownPanel from '../base/DropdownPanel.vue';

// Catalog dropdown for the gallery detail view's "show DSOs" photo overlay. Same
// markup/logic as DSOSection.vue's own catalog dropdown, but the selection here is
// local to this photo view — seeded once by the caller from the sky map's current
// selection (`displayStore.dsoCatalogs`), not two-way bound to it.
const props = defineProps<{
  modelValue: boolean;
  catalogs: string[];
}>();

const emit = defineEmits<{ 'update:catalogs': [string[]] }>();

const { t } = useI18n();

const catalogBtnRef = ref<HTMLButtonElement>();
const catalogSelectAllRef = ref<HTMLInputElement>();
const catalogOpen = ref(false);

const allCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.every((c) => props.catalogs.includes(c)),
);
const someCatalogsChecked = computed(() =>
  DSO_CATALOGS_ALL.some((c) => props.catalogs.includes(c)),
);

watch([allCatalogsChecked, someCatalogsChecked], () => {
  if (catalogSelectAllRef.value) {
    catalogSelectAllRef.value.indeterminate =
      someCatalogsChecked.value && !allCatalogsChecked.value;
  }
});

watch(catalogOpen, (open) => {
  if (open) {
    nextTick(() => {
      if (catalogSelectAllRef.value) {
        catalogSelectAllRef.value.indeterminate =
          someCatalogsChecked.value && !allCatalogsChecked.value;
      }
    });
  }
});

function toggleCatalog(cat: string, checked: boolean) {
  const next = DSO_CATALOGS_ALL.filter((c) => (c === cat ? checked : props.catalogs.includes(c)));
  emit('update:catalogs', next);
}

function toggleAllCatalogs(e: Event) {
  emit('update:catalogs', (e.target as HTMLInputElement).checked ? [...DSO_CATALOGS_ALL] : []);
}
</script>
