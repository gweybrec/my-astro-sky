<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { RenderableFrame } from '@myastrosky/core/sky-map-types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { frameKind, frameName, frameStatus, newPlanName } from '../../frame-text';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneCheckLeadRow from '../../components/PhoneCheckLeadRow.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneRadioGroup from '../../components/PhoneRadioGroup.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import AppIcon from '../../components/AppIcon.vue';
import SkySetupRows from './SkySetupRows.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import addFrameIcon from '@icons/add-frame.svg?raw';
import addMosaicIcon from '@icons/add-mosaic.svg?raw';
import planListIcon from '@icons/plan-list.svg?raw';

// The board "Ciel, contours de champ" (the desktop's frame manager, opened by the telescope button): all frames shown
// or hidden, the free frames or one plan's, and the list. A free frame's tick box shows it on the map; tapping a frame
// centres the map on it and selects it (its sheet opens). Then the desktop's actions: add a frame (a free one floats
// in the middle of the map with the setup chosen; a plan's is placed in the middle of the map), add a mosaic (with the
// mosaics), and in a plan its details. The plan's setup is chosen with the mosaics, which a change of setup reworks.
const props = defineProps<{ map: SkyMap | null }>();
const open = defineModel<boolean>('open', { required: true });
// A frame tapped in the list: the page centres it above the frame's sheet.
const emit = defineEmits<{ show: [id: string] }>();
const fov = useFovFramesStore();
const plans = usePlansStore();
const router = useRouter();
const { showError } = useErrorToast();

const FREE = '__free__';
const shown = computed({
  get: () => fov.framesVisible,
  set: (on: boolean) => {
    // Floating frames are fixed to the sky before they hide, so nothing drifts while they are hidden.
    if (!on) props.map?.pinAllFloatingFrames();
    fov.setFramesVisible(on);
  },
});

const setOpen = ref(false);
const selected = computed({
  get: () => (fov.selection.kind === 'plan' ? fov.selection.planId : FREE),
  set: (value: string | undefined) => {
    setOpen.value = false;
    if (!value || value === FREE) fov.setSelection({ kind: 'free' });
    else fov.setSelection({ kind: 'plan', planId: value });
  },
});
const setOptions = computed(() => [
  { value: FREE, label: t('fovOverlay.freeFrames') },
  ...plans.plans.map((p) => ({ value: p.id, label: p.name })),
]);
const setName = computed(
  () => setOptions.value.find((o) => o.value === selected.value)?.label ?? '',
);
const plan = computed(() =>
  fov.selection.kind === 'plan'
    ? plans.plans.find((p) => fov.selection.kind === 'plan' && p.id === fov.selection.planId)
    : undefined,
);
const isPlan = computed(() => fov.selection.kind === 'plan');

async function newPlan() {
  setOpen.value = false;
  try {
    const id = await plans.createPlan(newPlanName());
    if (id) fov.setSelection({ kind: 'plan', planId: id });
  } catch (error) {
    await showError(error);
  }
}

// The list: a mosaic's tiles are stood for by its outline.
const rows = computed(() => fov.renderables.filter((f) => !f.mosaicId || f.isMosaicOutline));
function grid(f: RenderableFrame) {
  if (!f.isMosaicOutline) return undefined;
  const [, owner, id] = f.id.split(':');
  if (owner === 'free') return fov.adhocMosaics.find((m) => m.id === id);
  return plans.plans.find((p) => p.id === owner)?.mosaics.find((m) => m.id === id);
}
const allShown = computed(() => rows.value.every((f) => f.visible !== false));
const someShown = computed(() => rows.value.some((f) => f.visible !== false));
function setShown(f: RenderableFrame, on: boolean) {
  if (frameKind(f) === 'freeMosaic') fov.setAdhocMosaicVisible(f.id.split(':')[2], on);
  else fov.setAdhocVisible(f.id, on);
}

function openFrame(f: RenderableFrame) {
  open.value = false;
  if (!fov.framesVisible) fov.setFramesVisible(true);
  props.map?.selectFrame(f.id);
  emit('show', f.id);
}

// "Ajouter un cadre": a free frame floats in the middle of the map with the setup chosen; a plan's frame is placed
// in the middle of the map and sized by the plan's setup.
const pickSetupOpen = ref(false);
const canAddFrame = computed(() => !isPlan.value || !!plan.value?.setupId);
function addFrame() {
  if (!isPlan.value) {
    pickSetupOpen.value = true;
    return;
  }
  const map = props.map;
  if (!map || !plan.value) return;
  map.pinActiveIfFloating();
  const { ra, dec } = map.viewCenterSky();
  open.value = false;
  fov.addPlanFrame(plan.value.id, ra, dec).catch((error) => void showError(error));
}
function addFreeFrame(setupId: string) {
  pickSetupOpen.value = false;
  open.value = false;
  props.map?.pinActiveIfFloating();
  if (!fov.framesVisible) fov.setFramesVisible(true);
  fov.addAdhocFrame(setupId);
}
function newSetup() {
  pickSetupOpen.value = false;
  open.value = false;
  void router.push('/settings/setups/new');
}
function openPlan() {
  if (!plan.value) return;
  open.value = false;
  void router.push(`/plans/${plan.value.id}`);
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('fovOverlay.popupTitle')" tall>
    <PhoneToggleRow v-model="shown" :title="t('fovOverlay.showFrames')" />
    <div class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="`${t('mobile.sky.frameSet')} : ${setName}`"
        @click="setOpen = true"
      >
        <span class="mob-btn-key">{{ t('mobile.sky.frameSet') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ setName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>

    <PhoneHelper v-if="isPlan && plan && !plan.setupId">{{
      t('fovOverlay.planNoSetup')
    }}</PhoneHelper>
    <PhoneHelper v-else-if="rows.length === 0">{{ t('fovOverlay.noFrames') }}</PhoneHelper>
    <IonList v-else class="mob-list" lines="none">
      <template v-if="!isPlan">
        <PhoneCheckLeadRow
          :model-value="allShown"
          :indeterminate="someShown && !allShown"
          :title="t('display.selectAll')"
          @update:model-value="fov.setAllAdhocVisible"
        />
        <PhoneCheckLeadRow
          v-for="f in rows"
          :key="f.id"
          :model-value="f.visible !== false"
          :title="frameName(f)"
          :subs="[frameStatus(f, grid(f))]"
          :check-label="`${t('fovOverlay.showOnMap')} : ${frameName(f)}`"
          button
          @update:model-value="setShown(f, $event)"
          @open="openFrame(f)"
        />
      </template>
      <template v-else>
        <PhoneRow
          v-for="f in rows"
          :key="f.id"
          :title="frameName(f)"
          :subs="[frameStatus(f, grid(f))].filter(Boolean)"
          button
          @click="openFrame(f)"
        />
      </template>
    </IonList>

    <!-- The board's gap above the actions is the sheet's ground, not the panel's. -->
    <div style="padding-top: var(--space-7)">
      <IonList class="mob-list" lines="none">
        <PhoneRow
          v-if="canAddFrame"
          :title="t('fovOverlay.addFrame')"
          :lead="addFrameIcon"
          button
          @click="addFrame"
        />
        <PhoneRow :title="t('fovOverlay.addMosaic')" :lead="addMosaicIcon" inert />
        <PhoneRow
          v-if="isPlan"
          :title="t('fovOverlay.openPlanDetails')"
          :lead="planListIcon"
          button
          @click="openPlan"
        />
      </IonList>
    </div>

    <PhoneSheet v-model:open="setOpen" :title="t('mobile.sky.frameSet')">
      <PhoneRadioGroup v-model="selected" :options="setOptions" :label="t('mobile.sky.frameSet')" />
      <PhoneRow :title="t('targets.plan.newPlan')" :lead="plusIcon" button @click="newPlan" />
    </PhoneSheet>
    <PhoneSheet v-model:open="pickSetupOpen" :title="t('fovOverlay.pickSetup')">
      <IonList class="mob-list" lines="none">
        <SkySetupRows @pick="addFreeFrame" @add="newSetup" />
      </IonList>
    </PhoneSheet>
  </PhoneSheet>
</template>
