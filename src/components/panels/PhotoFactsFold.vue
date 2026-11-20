<template>
  <div
    v-if="summaryParts.length || facts.length"
    class="flex flex-col mt-3"
    data-test="photo-facts"
  >
    <!-- The summary wraps like text, so nothing in it is hidden: the equipment name may break between its words, the
         time and the date never do. The chevron stays on the first line. -->
    <button
      type="button"
      class="sheet-section-toggle !items-start"
      :aria-expanded="isOpen"
      :title="isOpen ? t('photos.hideDetails') : t('photos.showDetails')"
      data-test="photo-facts-toggle"
      @click="toggle"
    >
      <span class="flex flex-none items-center h-[1lh] text-body">
        <span
          class="inline-flex transition-transform duration-150 [&>svg]:w-[12px] [&>svg]:h-[12px]"
          :class="{ '-rotate-90': !isOpen }"
          v-html="chevronSvg"
        ></span>
      </span>
      <span
        class="min-w-0 text-body text-secondary [overflow-wrap:anywhere]"
        data-test="photo-facts-summary"
      >
        <template v-if="summaryParts.length">
          <template v-for="(part, i) in summaryParts" :key="i">
            <span
              :class="{ 'whitespace-nowrap': i !== wrappingPart }"
              data-test="photo-facts-summary-part"
              >{{ part }}<template v-if="i < summaryParts.length - 1">&nbsp;·</template></span
            >{{ i < summaryParts.length - 1 ? ' ' : '' }}
          </template>
        </template>
        <template v-else>{{ t('photos.showDetails') }}</template>
      </span>
    </button>
    <div v-show="isOpen" class="flex flex-col mt-1" data-test="photo-facts-list">
      <template v-for="fact in facts" :key="fact.label">
        <!-- The exposures take the full width, one line each: the time first, the filter after. -->
        <template v-if="fact.exposures">
          <div class="sheet-row grid-cols-[minmax(0,1fr)] !mx-0 !px-0 hover:!bg-transparent">
            <span class="sheet-label" :title="fact.label">{{ fact.label }}</span>
          </div>
          <!-- One grid for all the lines, so the filters start at the same place. -->
          <div
            class="grid grid-cols-[auto_minmax(0,1fr)] auto-rows-[minmax(24px,auto)] items-center gap-x-4"
          >
            <div
              v-for="(exposure, i) in fact.exposures"
              :key="i"
              class="contents"
              data-test="photo-facts-exposure"
            >
              <span class="sheet-value font-mono">{{ exposure.time }}</span>
              <span class="sheet-value text-secondary" :title="exposure.filter">{{
                exposure.filter
              }}</span>
            </div>
          </div>
        </template>
        <!-- Long text (equipment, notes) goes under its label, on the full width of the card. -->
        <div v-else-if="fact.wide || fact.line" class="flex flex-col" data-test="photo-facts-wide">
          <div class="sheet-row grid-cols-[minmax(0,1fr)] !mx-0 !px-0 hover:!bg-transparent">
            <span class="sheet-label" :title="fact.label">{{ fact.label }}</span>
          </div>
          <span class="sheet-value !whitespace-normal [overflow-wrap:anywhere]">{{
            fact.value
          }}</span>
        </div>
        <!-- A label sits on the first line of its value. -->
        <div
          v-else
          class="sheet-row grid-cols-[104px_minmax(0,1fr)] !items-baseline !mx-0 !px-0 hover:!bg-transparent"
        >
          <span class="sheet-label" :title="fact.label">{{ fact.label }}</span>
          <span class="sheet-value !whitespace-normal [overflow-wrap:anywhere]">{{
            fact.value
          }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
const STORAGE_KEY = 'photo-card-details-open';

/** Whether the viewer unfolded the details, kept in this browser only (folded when storage is unavailable). */
function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts until the page reloads */
  }
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '../../i18n';
import { getGearSetups } from '../../api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { photoFacts, photoSummaryParts } from '@myastrosky/core/photo-facts';
import type { Photo } from '@myastrosky/core/types';

/**
 * The main facts of the photo selected on the map, read only: one summary line (equipment, total exposure, date)
 * that unfolds into the same facts as the phone's photo sheet. Remembers whether the viewer unfolded it.
 */
const props = defineProps<{ photo: Photo }>();

const chevronSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const isOpen = ref(readOpen());
function toggle() {
  isOpen.value = !isOpen.value;
  writeOpen(isOpen.value);
}

const setupName = ref<string>();
watch(
  () => props.photo.gearSetupId,
  async (id) => {
    setupName.value = undefined;
    if (!id) return;
    try {
      const setup = (await getGearSetups()).find((s) => s.id === id);
      // Another photo may have been selected while the list loaded.
      if (props.photo.gearSetupId === id)
        setupName.value = setup ? setup.name || setup.id : undefined;
    } catch (error) {
      reportError('PhotoFactsFold.setup', error);
    }
  },
  { immediate: true },
);

const summaryParts = computed(() => photoSummaryParts(props.photo, setupName.value));
// The equipment name (the summary's first part, when the photo has one) is the only part that may break.
const wrappingPart = computed(() => ((setupName.value ?? props.photo.sharedGear?.setup) ? 0 : -1));
const facts = computed(() =>
  photoFacts(props.photo, { setupName: setupName.value, brief: true, noChips: true }),
);
</script>
