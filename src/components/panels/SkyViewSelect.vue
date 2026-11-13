<template>
  <div v-if="store.skies.length > 0" class="display-controls-mag-row">
    <!-- The skies the map and the gallery show: tick boxes, like the Catalogs list. -->
    <button
      ref="buttonRef"
      type="button"
      class="display-controls-btn display-dropdown-btn labels-dropdown-btn"
      @click.stop="open = !open"
    >
      {{ t('sharedSky.viewSkies') }}{{ ` (${store.shown.length})` }}
    </button>
    <DropdownPanel v-model="open" :anchor-el="buttonRef" min-width="240px">
      <label class="labels-select-all-row">
        <input
          ref="allRef"
          type="checkbox"
          :checked="allChecked"
          :indeterminate.prop="someChecked && !allChecked"
          @change="(e) => setAll((e.target as HTMLInputElement).checked)"
        />
        <span class="labels-select-all-label">{{ t('display.selectAll') }}</span>
      </label>
      <label
        v-for="option in options"
        :key="option.value"
        class="dso-toggle-label labels-select-all-row"
      >
        <input
          type="checkbox"
          :checked="store.shown.includes(option.value)"
          @change="(e) => toggle(option.value, (e.target as HTMLInputElement).checked)"
        />
        <span class="ml-4 text-ellipsis" :title="labelOf(option)">{{ labelOf(option) }}</span>
      </label>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
/**
 * Which skies the map and the gallery show: the user's own and any visited ones, ticked in a list like the
 * Catalogs. Shown only once a sky has been visited. Unticking every sky shows no photo.
 */
import { computed, ref } from 'vue';
import { t } from '../../i18n';
import DropdownPanel from '../base/DropdownPanel.vue';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { skyChoiceOptions, type SkyChoiceOption } from '@myastrosky/core/shared-sky-view';
import { reportUnknownRendererError } from '../../error-reporter';

const store = useSharedSkiesStore();
const open = ref(false);
const buttonRef = ref<HTMLButtonElement>();
const allRef = ref<HTMLInputElement>();

const options = computed(() => skyChoiceOptions(store.skies));
const allChecked = computed(() => options.value.every((o) => store.shown.includes(o.value)));
const someChecked = computed(() => store.shown.length > 0);

const labelOf = (option: SkyChoiceOption) =>
  option.labelKey ? t(option.labelKey) : (option.label ?? '');

function show(values: string[]) {
  store.show(values).catch((err) => reportUnknownRendererError('shared_sky_show', err));
}

function toggle(value: string, checked: boolean) {
  show(
    options.value
      .map((o) => o.value)
      .filter((v) => (v === value ? checked : store.shown.includes(v))),
  );
}

function setAll(checked: boolean) {
  show(checked ? options.value.map((o) => o.value) : []);
}
</script>
