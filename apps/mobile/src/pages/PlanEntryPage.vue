<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatPaDeg } from '@myastrosky/core/frame-orientation';
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
import { usePlanWindows } from '../composables/usePlanWindows';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useShowTargetOnMap } from '../composables/useShowTargetOnMap';
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
import mapPinIcon from '@icons/map-pin.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Plan, détail d'une cible" and "Plan, fenêtre d'observation": the target's figures for the plan's night
// and setup, its suggested filters (board "Plan, cible, filtres suggérés": the desktop's recipe, a sheet), its
// observation windows (`usePlanWindows`), showing it on the map (as the desktop: a free frame of the setup on the
// target, the map zoomed on that frame) and the removal of the target from the plan.
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

const angle = computed(() => (entry.value?.paDeg != null ? formatPaDeg(entry.value.paDeg) : '—'));
const {
  rows: windows,
  chartWindows,
  editing,
  editorOpen,
  isNew,
  openWindow,
  addWindow,
  addFilter,
  resume,
  saveWindow,
  deleteWindow,
} = usePlanWindows({
  stored: () => entry.value?.observationWindows ?? [],
  night: () => night.value?.win ?? null,
  save: saveWindows,
});

async function load() {
  try {
    await resume();
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

// The desktop's "Afficher sur la carte", with the plan's setup.
// The map goes back to this page; once its frame was moved onto another object, to that object's page for this plan
// (where it can be added to the plan).
const showTargetOnMap = useShowTargetOnMap({
  tab: 'plans',
  pages: [`/plans/${planId.value}`],
  page: `/plans/${planId.value}/${entryId.value}`,
  pageOf: (id) => `/plans/${planId.value}/targets/${encodeURIComponent(id)}`,
});
async function showOnMap() {
  if (dso.value) await showTargetOnMap(dso.value, setupId.value);
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
      :is-new="isNew"
      @save="saveWindow"
      @delete="deleteWindow"
      @add-filter="addFilter"
    />
  </IonPage>
</template>
