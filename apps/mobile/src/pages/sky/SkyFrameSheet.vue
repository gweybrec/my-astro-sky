<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { frameDragging } from '../../sky-frames';
import { frameKind, frameName, frameRotation } from '../../frame-text';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import { useSheetDrag } from '../../composables/useSheetDrag';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneStepperRow from '../../components/PhoneStepperRow.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import listPlusIcon from '@icons/list-plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import penIcon from '@icons/pen.svg?raw';

// The board "Ciel, cadre sélectionné": the selected frame in a sheet over the bottom of the map. Its rotation (slider),
// pinning, the anchor (a pinned frame snaps to the nearest object), moving a free frame into a plan,
// deleting it. While a finger drags the frame the sheet shrinks to its title (board "Ciel, déplacer le cadre"). It
// closes as the object sheet does: dragging down, the handle, a tap on an empty spot and the back button, and the frame
// is let go of. A mosaic (board "Ciel, mosaïque sélectionnée") adds its Lignes / Colonnes, which re-tile it about its
// centre, and for a plan's mosaic "Modifier la mosaïque" (the desktop's edit button), which the page opens.
const props = defineProps<{ frame: RenderableFrame; map: SkyMap }>();
const emit = defineEmits<{ close: []; editMosaic: [planId: string, mosaicId: string] }>();
const titleId = useId();
const fov = useFovFramesStore();
const plans = usePlansStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const drag = useSheetDrag(() => emit('close'));

const kind = computed(() => frameKind(props.frame));
const title = computed(() =>
  kind.value === 'free' ? (props.frame.anchorLabel ?? props.frame.label) : frameName(props.frame),
);

const rotation = computed({
  get: () => frameRotation(props.frame),
  set: (deg: number) => {
    const d = ((deg % 360) + 360) % 360;
    if (props.frame.anchorKind === 'sky') fov.applyChange(props.frame.id, { paDeg: d });
    // A floating frame keeps its screen angle between -180 and 180, as the desktop does.
    else fov.applyChange(props.frame.id, { screenRotationDeg: d > 180 ? d - 360 : d });
  },
});

const pinned = computed({
  get: () => props.frame.anchorKind === 'sky',
  set: () => props.map.toggleFramePinById(props.frame.id),
});
const anchored = computed({
  get: () => props.frame.anchorSnap !== false,
  set: (on: boolean) => {
    fov.toggleAnchorSnap(props.frame.id);
    // Turning the anchor on snaps a pinned frame onto a nearby object, as pinning does.
    if (on) props.map.resnapFrame(props.frame.id);
  },
});

// Moving a free frame or mosaic into a plan: only a plan with the same setup takes it (the others are greyed, with
// the desktop's reason).
const moveOpen = ref(false);
const freeSetupId = computed(() => {
  if (kind.value === 'free') return fov.adhoc.find((a) => a.id === props.frame.id)?.setupId ?? null;
  if (kind.value === 'freeMosaic') {
    const id = props.frame.id.split(':')[2];
    return fov.adhocMosaics.find((m) => m.id === id)?.setupId ?? null;
  }
  return null;
});
const canMove = computed(
  () => (kind.value === 'free' || kind.value === 'freeMosaic') && plans.plans.length > 0,
);
const planChoices = computed(() =>
  plans.plans.map((p) => ({
    id: p.id,
    name: p.name,
    reason:
      freeSetupId.value && p.setupId === freeSetupId.value
        ? null
        : p.setupId
          ? t('fovOverlay.planSetupMismatch')
          : t('fovOverlay.planNoSetup'),
  })),
);
async function moveTo(planId: string) {
  // A greyed plan (another setup, or none) does not take the frame.
  if (planChoices.value.find((p) => p.id === planId)?.reason) return;
  moveOpen.value = false;
  // A floating frame is pinned first so it has a place in the sky to take along.
  if (props.frame.anchorKind === 'screen') props.map.toggleFramePinById(props.frame.id);
  try {
    if (kind.value === 'freeMosaic') {
      await fov.migrateFreeMosaicToPlan(props.frame.id.split(':')[2], planId);
    } else {
      await fov.migrateFreeFrameToPlan(props.frame.id, planId);
    }
  } catch (error) {
    await showError(error);
  }
}

const isMosaic = computed(() => kind.value === 'freeMosaic' || kind.value === 'planMosaic');
const mosaicIds = computed(() => {
  const [, owner, id] = props.frame.id.split(':');
  return { owner, id };
});
const mosaic = computed(() => {
  if (!isMosaic.value) return undefined;
  const { owner, id } = mosaicIds.value;
  if (owner === 'free') return fov.adhocMosaics.find((m) => m.id === id);
  return plans.plans.find((p) => p.id === owner)?.mosaics.find((m) => m.id === id);
});
const rows = computed({
  get: () => mosaic.value?.rows ?? 1,
  set: (n: number) => mosaic.value && fov.setMosaicGrid(mosaic.value.id, mosaic.value.cols, n),
});
const cols = computed({
  get: () => mosaic.value?.cols ?? 1,
  set: (n: number) => mosaic.value && fov.setMosaicGrid(mosaic.value.id, n, mosaic.value.rows),
});
function editMosaic() {
  const { owner, id } = mosaicIds.value;
  emit('editMosaic', owner, id);
}
async function remove() {
  const name = frameName(props.frame);
  const ok = await confirm({
    title: isMosaic.value ? t('fovOverlay.deleteMosaic') : t('fovOverlay.deleteFrame'),
    message:
      kind.value === 'freeMosaic'
        ? t('fovOverlay.deleteMosaicConfirmFree', { name })
        : kind.value === 'free'
          ? name
          : t('fovOverlay.deleteFrameConfirm', { name }),
    confirmLabel: isMosaic.value ? t('fovOverlay.deleteMosaic') : t('fovOverlay.deleteFrame'),
    destructive: true,
  });
  if (!ok) return;
  const [, planId, id] = props.frame.id.split(':');
  try {
    if (kind.value === 'free') fov.removeFrame(props.frame.id);
    else if (kind.value === 'plan') await fov.deletePlanFrame(props.frame.id);
    else if (kind.value === 'freeMosaic') fov.removeAdhocMosaic(id);
    else await plans.deleteMosaic(planId, id);
  } catch (error) {
    await showError(error);
  }
  emit('close');
}
</script>

<template>
  <section class="mob-sheet mob-sheet--auto mob-map-sheet" :aria-labelledby="titleId">
    <div class="mob-sheet-drag" v-on="drag">
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="t('mobile.sky.closeSheet')"
        @click="emit('close')"
      >
        <span class="mob-sheet-handle" />
      </button>
      <div class="mob-sheet-header">
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ title }}</h2>
        <div v-show="!frameDragging" class="mob-meta m-secondary">
          <span>{{ frame.label }}</span>
        </div>
      </div>
    </div>
    <div v-show="!frameDragging" class="mob-sheet-body mob-scroll">
      <PhoneSliderRow
        v-model="rotation"
        :label="t('manual.rotation')"
        :min="0"
        :max="359"
        :display="`${rotation}°`"
      />
      <PhoneToggleRow v-if="frame.pinnable" v-model="pinned" :title="t('mobile.sky.framePin')" />
      <PhoneToggleRow
        v-model="anchored"
        :title="t('mobile.sky.frameAnchor')"
        :sub="t('mobile.sky.frameAnchorSub')"
      />
      <template v-if="mosaic">
        <PhoneStepperRow
          v-model="rows"
          :label="t('fovOverlay.mosaicRows')"
          :less-label="t('mobile.sky.rowsLess')"
          :more-label="t('mobile.sky.rowsMore')"
          :min="1"
        />
        <PhoneStepperRow
          v-model="cols"
          :label="t('fovOverlay.mosaicColumns')"
          :less-label="t('mobile.sky.colsLess')"
          :more-label="t('mobile.sky.colsMore')"
          :min="1"
        />
        <PhoneRow
          v-if="kind === 'planMosaic'"
          :title="t('fovOverlay.editMosaicTitle')"
          :lead="penIcon"
          button
          @click="editMosaic"
        />
      </template>
      <PhoneRow
        v-if="canMove"
        :title="t('fovOverlay.moveToPlan')"
        :lead="listPlusIcon"
        button
        @click="moveOpen = true"
      />
      <PhoneRow
        :title="isMosaic ? t('fovOverlay.deleteMosaic') : t('fovOverlay.deleteFrame')"
        :lead="trashIcon"
        danger
        button
        @click="remove"
      />
    </div>
    <PhoneSheet v-model:open="moveOpen" :title="t('fovOverlay.moveToPlan')" :subtitle="title">
      <PhoneRow
        v-for="p in planChoices"
        :key="p.id"
        :title="p.name"
        :subs="p.reason ? [p.reason] : []"
        :disabled="p.reason !== null"
        button
        @click="moveTo(p.id)"
      />
    </PhoneSheet>
  </section>
</template>
