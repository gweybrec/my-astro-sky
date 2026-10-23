<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatPaDeg } from '@myastrosky/core/frame-orientation';
import {
  fracToClock,
  framesInWindow,
  newObservationWindow,
} from '@myastrosky/core/observation-windows';
import { resolvePlanNight, scorePlanEntry } from '@myastrosky/core/targets/plan';
import {
  presetForSetupId,
  resolveSetupById,
  type GearLists,
} from '@myastrosky/core/targets/plan-setup';
import {
  removePlanEntryAPI,
  updatePlanEntryPositionAPI,
  type ObservationWindow,
  type Plan,
} from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { skyFocus } from '../composables/useSkySelection';
import { openTab } from '../tab-navigation';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import ObsWindowSheet from './plans/ObsWindowSheet.vue';
import TargetSummary from './targets/TargetSummary.vue';
import { filterColor } from '../filter-color';
import mapPinIcon from '@icons/map-pin.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Plan, détail d'une cible" and "Plan, fenêtre d'observation": the target's figures for the plan's night
// and setup, its suggested filters (board "Plan, cible, filtres suggérés": the desktop's recipe, a sheet), its
// observation windows (a tap opens one; the plus adds one), showing it on the map (as the desktop: a free frame of the
// setup on the target, the map zoomed on that frame) and the removal of the target from the plan.
const route = useRoute();
const router = useRouter();
const store = usePlansStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const planId = computed(() => String(route.params.id));
const entryId = computed(() => String(route.params.entryId));
const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === planId.value));
const entry = computed(() => plan.value?.entries.find((e) => e.id === entryId.value));
const gear = shallowRef<GearLists | null>(null);
const editingId = ref<string | null>(null);
const editorOpen = ref(false);
/** A window being added: stored only when its sheet's "Enregistrer" is tapped. */
const draft = ref<ObservationWindow | null>(null);
watch(editorOpen, (isOpen) => {
  if (!isOpen) draft.value = null;
});

const night = computed(() =>
  plan.value ? resolvePlanNight(plan.value, targetsPrefs, planLookups) : null,
);
const info = computed(() => night.value?.infos.find((i) => i.entryId === entryId.value));
const dso = computed(() => {
  if (info.value) return info.value.dso;
  const e = entry.value;
  return e?.dsoId ? planLookups.getDsoById(e.dsoId) : undefined;
});
const name = computed(
  () => dso.value?.displayName || dso.value?.catalogs[0] || dso.value?.id || '',
);

const setupId = computed(() => plan.value?.setupId ?? targetsPrefs.setupId);
const setup = computed(() => (gear.value ? resolveSetupById(setupId.value, gear.value) : null));
const preset = computed(() => (gear.value ? presetForSetupId(setupId.value, gear.value) : null));
const scores = computed(() =>
  info.value && preset.value
    ? scorePlanEntry(info.value.dso, preset.value, info.value.maxAltDeg, targetsPrefs)
    : null,
);

/** The window's colour dot: the one chosen, else its filter's. */
const colorOf = (w: ObservationWindow) => w.color || filterColor(w.filter);

const windows = computed(() =>
  [...(entry.value?.observationWindows ?? [])]
    .sort((a, b) => a.startFrac - b.startFrac)
    .map((w) => {
      const win = night.value?.win;
      const span = win ? win.end.getTime() - win.start.getTime() : 0;
      const frames = win ? framesInWindow(w, span) : null;
      return {
        w,
        title: w.filter || t('targets.plan.obsWindowTitle'),
        range: win ? `${fracToClock(w.startFrac, win)} – ${fracToClock(w.endFrac, win)}` : '',
        frames: w.frameSeconds && frames !== null ? `${frames} × ${w.frameSeconds} s` : '',
        color: colorOf(w),
      };
    }),
);
// The windows as bands of the altitude chart, in their colours.
const chartWindows = computed(() =>
  windows.value.map((row) => ({
    startFrac: row.w.startFrac,
    endFrac: row.w.endFrac,
    color: row.color,
  })),
);
const angle = computed(() => (entry.value?.paDeg != null ? formatPaDeg(entry.value.paDeg) : '—'));
const editing = computed(() =>
  draft.value && draft.value.id === editingId.value
    ? draft.value
    : (entry.value?.observationWindows.find((w) => w.id === editingId.value) ?? null),
);

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    await store.load();
    gear.value = await loadGearLists();
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

/** Writes the entry's whole list of windows (one request) and reads the plans again. */
async function saveWindows(next: ObservationWindow[]) {
  await updatePlanEntryPositionAPI(planId.value, entryId.value, { observationWindows: next });
  await store.load();
}

function openWindow(id: string) {
  editingId.value = id;
  editorOpen.value = true;
}

function addWindow() {
  draft.value = newObservationWindow();
  openWindow(draft.value.id);
}

async function saveWindow(changes: {
  startFrac: number;
  endFrac: number;
  frameSeconds: number | null;
  snap: boolean;
}) {
  const id = editingId.value;
  const added = draft.value;
  editorOpen.value = false;
  if (!id) return;
  const stored = entry.value?.observationWindows ?? [];
  try {
    await saveWindows(
      added?.id === id
        ? [...stored, { ...added, ...changes }]
        : stored.map((w) => (w.id === id ? { ...w, ...changes } : w)),
    );
  } catch (error) {
    void showError(error);
  }
}

async function deleteWindow() {
  const id = editingId.value;
  if (!id) return;
  // The editor stays open under the question: "Annuler" leaves it as it was.
  const sure = await confirm({
    title: t('targets.plan.obsWindowRemove'),
    message: t('mobile.plans.deleteWindowMessage'),
    confirmLabel: t('mobile.plans.delete'),
    destructive: true,
  });
  if (!sure) return;
  editorOpen.value = false;
  try {
    await saveWindows((entry.value?.observationWindows ?? []).filter((w) => w.id !== id));
  } catch (error) {
    void showError(error);
  }
}

// The desktop's "Afficher sur la carte" (`onNavigate` in its main.ts): with a setup, a free frame of that setup pinned
// on the target, frames shown and the map zoomed on the frame (its sheet opens there); without one, the map at the target.
const fov = useFovFramesStore();
async function showOnMap() {
  const d = dso.value;
  if (!d) return;
  const id = setupId.value;
  if (id && !fov.specs.has(id)) await fov.loadSpecs();
  const spec = id ? fov.specs.get(id) : undefined;
  if (id && spec) {
    fov.addAdhocFrameAtSky(id, d.ra, d.dec);
    fov.setFramesVisible(true);
    skyFocus.value = { ra: d.ra, dec: d.dec, scale: 0, fov: { wDeg: spec.wDeg, hDeg: spec.hDeg } };
  } else {
    skyFocus.value = { ra: d.ra, dec: d.dec, scale: 800 };
  }
  await openTab(router, 'plans', 'sky');
}

async function removeFromPlan() {
  const sure = await confirm({
    title: t('targets.plan.remove'),
    message: t('fovOverlay.deleteFrameConfirm', { name: name.value }),
    confirmLabel: t('targets.plan.remove'),
    destructive: true,
  });
  if (!sure) return;
  try {
    await removePlanEntryAPI(planId.value, entryId.value);
    router.back();
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="`/plans/${planId}`" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ name }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="dso" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <TargetSummary
          :dso="dso"
          :info="info ?? null"
          :night="night"
          :scores="scores"
          :angle="angle"
          :windows="chartWindows"
          :filters-subtitle="setup ? `${name} · ${setup.name}` : name"
        />
        <PhoneSectionHeader>{{ t('mobile.plans.windowsHeader') }}</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-for="row in windows"
            :key="row.w.id"
            :title="row.title"
            :subs="row.range ? [row.range] : []"
            :value="row.frames"
            :swatch="row.color"
            mono
            button
            chevron
            @click="openWindow(row.w.id)"
          />
          <PhoneRow
            :title="t('targets.plan.obsWindowTitle')"
            :lead="plusIcon"
            button
            @click="addWindow"
          />
        </IonList>
        <IonList class="mob-list" lines="none" style="padding-top: var(--space-7)">
          <PhoneRow
            :title="t('targets.plan.showOnMap')"
            :lead="mapPinIcon"
            button
            @click="showOnMap"
          />
          <PhoneRow
            :title="t('targets.plan.remove')"
            :lead="trashIcon"
            danger
            button
            @click="removeFromPlan"
          />
        </IonList>
      </div>
    </IonContent>
    <ObsWindowSheet
      v-model:open="editorOpen"
      :window="editing"
      :subtitle="setup ? `${name} · ${setup.name}` : name"
      :night="night?.win ?? null"
      :swatch="editing ? colorOf(editing) : ''"
      :is-new="draft !== null"
      @save="saveWindow"
      @delete="deleteWindow"
    />
  </IonPage>
</template>
