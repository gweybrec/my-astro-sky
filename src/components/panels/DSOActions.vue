<template>
  <div class="flex gap-2 mt-4">
    <button
      ref="planBtnRef"
      class="btn-icon flex-1 flex items-center justify-center"
      :class="{ 'bg-[var(--accent-fill-sm)]': inAnyPlan }"
      :title="t('targets.plan.addToPlan')"
      :aria-label="t('targets.plan.addToPlan')"
      @click.stop="pickerOpen = !pickerOpen"
      v-html="listPlusSvg"
    ></button>
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('fovOverlay.addFrame')"
      :aria-label="t('fovOverlay.addFrame')"
      @click.stop="onAddFrame"
      v-html="addFrameSvg"
    ></button>
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('fovOverlay.addMosaic')"
      :aria-label="t('fovOverlay.addMosaic')"
      @click.stop="onAddMosaic"
      v-html="addMosaicSvg"
    ></button>
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('dso.edit')"
      :aria-label="t('dso.edit')"
      @click.stop="$emit('edit')"
      v-html="penSvg"
    ></button>

    <DropdownPanel v-model="pickerOpen" :anchor-el="planBtnRef" align-right min-width="220px">
      <div class="px-3 pb-1 text-micro uppercase text-label">{{ t('targets.plan.pickerTitle') }}</div>
      <button
        v-for="plan in plansStore.plans"
        :key="plan.id"
        type="button"
        class="flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]"
        @click="toggle(plan.id)"
      >
        <span class="w-4 shrink-0 text-bright">{{ plansStore.isInPlan(dso.id, plan.id) ? '✓' : '' }}</span>
        <span class="flex-1 truncate">{{ plan.name }}</span>
      </button>
      <div class="border-t border-subtle my-1"></div>
      <button
        type="button"
        class="flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]"
        @click="newPlan"
      >+ {{ t('targets.plan.newPlan') }}</button>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { t } from '../../i18n';
import type { DSO } from '../../types';
import { usePlansStore } from '../../stores/plans';
import { useUiStore } from '../../stores/ui';
import { useFovFramesStore } from '../../stores/fov-frames';
import { useCanvasStore } from '../../stores/canvas';
import { openSetupPicker } from '../../fov-overlay';
import DropdownPanel from '../base/DropdownPanel.vue';
import penSvg from '../../icons/pen.svg?raw';
import listPlusSvg from '../../icons/list-plus.svg?raw';
import addFrameSvg from '../../icons/add-frame.svg?raw';
import addMosaicSvg from '../../icons/add-mosaic.svg?raw';

// `pinsTooltip` is set when these actions live inside the floating sky tooltip:
// while the plan picker (teleported to <body>) is open, the tooltip must not
// auto-hide as the cursor leaves it for the picker.
const props = defineProps<{ dso: DSO; pinsTooltip?: boolean }>();
defineEmits<{ edit: [] }>();

const plansStore = usePlansStore();
const uiStore = useUiStore();
const fovStore = useFovFramesStore();
const canvasStore = useCanvasStore();
const pickerOpen = ref(false);
const planBtnRef = ref<HTMLButtonElement>();
const inAnyPlan = computed(() => plansStore.plansContaining(props.dso.id).length > 0);

onMounted(() => { plansStore.ensureLoaded(); });

watch(pickerOpen, (open) => {
  if (props.pinsTooltip) uiStore.setSkyTooltipPinned(open);
});

async function toggle(planId: string) {
  await plansStore.toggleEntry(planId, props.dso.id);
}

async function newPlan() {
  const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const id = await plansStore.createPlan(t('targets.plan.defaultName', { date }));
  if (id) await plansStore.addEntry(id, props.dso.id);
}

// Switch to the sky map, reveal frames, centre on the DSO, and open the frame
// manager — the shared tail of "add frame"/"add mosaic" (mirrors the Targets
// "show on map" flow).
function revealOnMap() {
  if (props.pinsTooltip) uiStore.hideSkyTooltipNow();
  fovStore.setFramesVisible(true);
  uiStore.switchView('skymap');
  const sm = canvasStore.skyMap;
  if (sm) sm.navigateTo(props.dso.ra, props.dso.dec, Math.max(sm.getView().scale, 1200));
  fovStore.requestPopupOpen();
}

function onAddFrame() {
  openSetupPicker((setupId) => {
    fovStore.addAdhocFrameAtSky(setupId, props.dso.ra, props.dso.dec, props.dso.id);
    revealOnMap();
  });
}

function onAddMosaic() {
  // Smart telescopes have their own mosaic mode, so they're excluded here.
  openSetupPicker((setupId) => {
    fovStore.addAdhocMosaic(setupId, props.dso.ra, props.dso.dec, props.dso.id);
    revealOnMap();
  }, { excludeSmart: true });
}
</script>
