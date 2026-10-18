<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { DSO } from '@myastrosky/core/types';
import { searchDSOs } from '@myastrosky/core/search';
import { getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { formatFov } from '@myastrosky/core/gear-presets';
import {
  MOSAIC_DEFAULT_OVERLAP,
  entriesCoveredByMosaic,
  mosaicPlacement,
  mosaicSummary,
  mosaicTiles,
} from '@myastrosky/core/mosaic-form';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneRemoveChips from '../../components/PhoneRemoveChips.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneStepperRow from '../../components/PhoneStepperRow.vue';

// The board "Ciel, nouvelle mosaïque": the desktop's mosaic form (fov-overlay.ts buildMosaicModal) as a tall sheet,
// opened by "Ajouter une mosaïque" of "Contours de champ" (for a plan, or a free mosaic of the setup picked first) and,
// filled, by "Modifier la mosaïque" of a plan mosaic's sheet. Its fields in the desktop's order: Nom and Cible
// (required; each object found and tapped becomes a chip), Chevauchement, Colonnes, Lignes and the summary. Picking
// objects or changing the overlap sets the grid that covers them; one object centres the mosaic on it, several between
// them; editing with none keeps the mosaic where it is. A new plan mosaic replaces the plan's frames it covers.
export type MosaicDest = { kind: 'plan'; planId: string } | { kind: 'free'; setupId: string };
const props = defineProps<{
  dest: MosaicDest;
  /** The plan mosaic being edited; none to create one. */
  mosaicId?: string | null;
  /** Objects already picked when it opens (the selected object of the map). */
  seed?: DSO[];
}>();
const open = defineModel<boolean>('open', { required: true });
// The mosaic made or saved (the page shows it on the map).
const emit = defineEmits<{ done: [] }>();
const fov = useFovFramesStore();
const plans = usePlansStore();
const { showError } = useErrorToast();

const plan = computed(() =>
  props.dest.kind === 'plan'
    ? plans.plans.find((p) => props.dest.kind === 'plan' && p.id === props.dest.planId)
    : undefined,
);
const edited = computed(() =>
  props.mosaicId ? plan.value?.mosaics.find((m) => m.id === props.mosaicId) : undefined,
);
const spec = computed(() => {
  const setupId = props.dest.kind === 'plan' ? plan.value?.setupId : props.dest.setupId;
  return setupId ? fov.specs.get(setupId) : undefined;
});

const form = reactive({
  name: '',
  targets: [] as DSO[],
  overlap: MOSAIC_DEFAULT_OVERLAP,
  cols: 1,
  rows: 1,
});
const saving = ref(false);

const placement = () =>
  spec.value
    ? mosaicPlacement(form.targets, spec.value.wDeg, spec.value.hDeg, form.overlap, edited.value)
    : null;
/** The objects (or the overlap) set the grid: the one that covers them. With none, the user's grid stays. */
function gridFromTargets() {
  const p = placement();
  if (p && form.targets.length > 0) {
    form.cols = p.auto.cols;
    form.rows = p.auto.rows;
  }
}

const query = ref('');
const results = ref<DSO[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (text) => {
  clearTimeout(searchTimer);
  const q = text.trim();
  if (!q) {
    results.value = [];
    return;
  }
  searchTimer = setTimeout(() => {
    results.value = searchDSOs(q, 8)
      .map((r) => r.dso)
      .filter((d) => !form.targets.some((s) => s.id === d.id));
  }, 200);
});
// Filled each time it opens (it may be mounted open).
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const m = edited.value;
    const seedDso = m?.dsoId ? getDSOById(m.dsoId) : undefined;
    form.name = m?.name ?? '';
    form.targets = m ? (seedDso ? [seedDso] : []) : [...(props.seed ?? [])];
    form.overlap = m?.overlapPct ?? MOSAIC_DEFAULT_OVERLAP;
    form.cols = m?.cols ?? 1;
    form.rows = m?.rows ?? 1;
    query.value = '';
    if (!m) gridFromTargets();
  },
  { immediate: true },
);
const resultTitle = (d: DSO) => (d.displayName ? `${d.id} — ${d.displayName}` : d.id);
function addTarget(d: DSO) {
  if (!form.targets.some((s) => s.id === d.id)) form.targets.push(d);
  query.value = '';
  gridFromTargets();
}
function removeTarget(index: number) {
  form.targets.splice(index, 1);
  gridFromTargets();
}
const overlap = computed({
  get: () => form.overlap,
  set: (n: number) => {
    form.overlap = n;
    gridFromTargets();
  },
});

const summary = computed(() =>
  spec.value
    ? mosaicSummary(
        form.cols,
        form.rows,
        spec.value.wDeg,
        spec.value.hDeg,
        form.overlap,
        t('fovOverlay.mosaicPanels'),
        formatFov,
      )
    : '',
);
// A name is required; an object too, except when editing (none keeps the mosaic where it is).
const canSave = computed(
  () =>
    !saving.value &&
    !!spec.value &&
    form.name.trim() !== '' &&
    (form.targets.length > 0 || !!edited.value),
);

async function save() {
  const p = placement();
  const s = spec.value;
  if (!canSave.value || !p || !s) return;
  saving.value = true;
  const name = form.name.trim();
  // One object stays anchored to it; several (or none) un-anchor to the centre.
  const dsoId = form.targets.length === 1 ? form.targets[0].id : null;
  const tiles = mosaicTiles(p.center, p.paDeg, form.cols, form.rows, s.wDeg, s.hDeg, form.overlap);
  const params = {
    dsoId,
    name,
    centerRa: p.center.ra,
    centerDec: p.center.dec,
    paDeg: p.paDeg,
    overlapPct: form.overlap,
    cols: form.cols,
    rows: form.rows,
    tiles,
  };
  try {
    fov.setFramesVisible(true);
    if (props.dest.kind === 'free') {
      fov.createAdhocMosaic({ setupId: props.dest.setupId, ...params });
    } else {
      const planId = props.dest.planId;
      fov.setSelection({ kind: 'plan', planId });
      if (edited.value) {
        await plans.updateMosaic(planId, edited.value.id, params);
        fov.setActiveMosaic(edited.value.id);
      } else {
        const replaceEntryIds = entriesCoveredByMosaic(
          plan.value?.entries ?? [],
          dsoId,
          p.center,
          form.cols,
          form.rows,
          s.wDeg,
          s.hDeg,
          form.overlap,
        );
        const id = await plans.createMosaic(planId, { ...params, replaceEntryIds });
        if (id) fov.setActiveMosaic(id);
      }
    }
    open.value = false;
    emit('done');
  } catch (error) {
    await showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PhoneSheet
    v-model:open="open"
    :title="mosaicId ? t('fovOverlay.editMosaicTitle') : t('fovOverlay.mosaicTitle')"
    tall
  >
    <PhoneField
      v-model="form.name"
      :label="t('fovOverlay.mosaicName')"
      :placeholder="t('fovOverlay.mosaicNamePlaceholder')"
      required
    />
    <PhoneField
      v-model="query"
      type="search"
      :label="t('fovOverlay.mosaicTarget')"
      :placeholder="t('fovOverlay.mosaicTargetPlaceholder')"
      :required="!mosaicId"
    />
    <IonList v-if="results.length" class="mob-list" lines="none">
      <PhoneRow
        v-for="d in results"
        :key="d.id"
        :title="resultTitle(d)"
        button
        @click="addTarget(d)"
      />
    </IonList>
    <PhoneRemoveChips
      :items="form.targets.map((d) => ({ label: d.displayName || d.id }))"
      @remove="removeTarget"
    />
    <PhoneStepperRow
      v-model="overlap"
      :label="t('fovOverlay.mosaicOverlap')"
      :less-label="t('mobile.sky.overlapLess')"
      :more-label="t('mobile.sky.overlapMore')"
      :min="0"
      :max="90"
      :step="5"
    />
    <PhoneStepperRow
      v-model="form.cols"
      :label="t('fovOverlay.mosaicColumns')"
      :less-label="t('mobile.sky.colsLess')"
      :more-label="t('mobile.sky.colsMore')"
      :min="1"
    />
    <PhoneStepperRow
      v-model="form.rows"
      :label="t('fovOverlay.mosaicRows')"
      :less-label="t('mobile.sky.rowsLess')"
      :more-label="t('mobile.sky.rowsMore')"
      :min="1"
    />
    <PhoneHelper v-if="summary">{{ summary }}</PhoneHelper>
    <template #footer>
      <PhoneButton size="lg" @click="open = false">{{ t('targets.gear.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!canSave" @click="save">{{
        mosaicId ? t('targets.gear.save') : t('fovOverlay.mosaicCreate')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
