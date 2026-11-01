<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { planSearchPrefs } from '@myastrosky/core/targets/night';
import { resolvePlanNight, scorePlanEntry } from '@myastrosky/core/targets/plan';
import {
  presetForSetupId,
  resolveSetupById,
  type GearLists,
} from '@myastrosky/core/targets/plan-setup';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { buildMultipleStarTargets } from '@myastrosky/core/targets/multiple-stars';
import type { DSO } from '@myastrosky/core/types';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import { useShowTargetOnMap } from '../composables/useShowTargetOnMap';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PlanPickerSheet from './targets/PlanPickerSheet.vue';
import TargetSummary from './targets/TargetSummary.vue';
import listPlusIcon from '@icons/list-plus.svg?raw';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The board "Cibles, détail d'une cible", opened from a result of the Cibles list: the target for the night and the
// setup of the search (the plan's target page's summary: figures, altitude chart, suggested filters), then the
// desktop's actions on a result: showing it on the map with the search's setup, and adding it to a plan (the desktop's
// picker, PlanPickerSheet). The board has no "Modifier": an object is corrected from the map's object sheet.
// Opened from the Cibles list of a plan (`/plans/:id/targets/:dsoId`, board "Plan, ajouter une cible, détail"): the
// night, place and setup are the plan's, and the picker is "Ajouter au plan", which adds to that plan only (greyed when
// the target is in it already).
const route = useRoute();
const plans = usePlansStore();
const { showError, showNotice } = useErrorToast();

/** The plan the page adds to, when it was opened from one. */
const planId = route.params.id ? String(route.params.id) : null;
const plan = computed(() => (planId ? plans.plans.find((p) => p.id === planId) : undefined));
/** The search's settings, with the plan's place, night and setup over them. */
const prefs = computed(() =>
  plan.value ? planSearchPrefs({ ...targetsPrefs }, plan.value) : targetsPrefs,
);

const dsoId = computed(() => String(route.params.dsoId));
const gear = shallowRef<GearLists | null>(null);
const ready = ref(false);
/** A multiple star of the list (`star:<HIP>`): not in the deep-sky catalogue, made by the search for the setup. */
const isStar = computed(() => dsoId.value.startsWith('star:'));
const preset = computed(() =>
  gear.value ? presetForSetupId(prefs.value.setupId, gear.value) : null,
);
const dso = computed<DSO | undefined>(() => {
  if (!ready.value) return undefined;
  if (!isStar.value) return planLookups.getDsoById(dsoId.value);
  return preset.value
    ? buildMultipleStarTargets(preset.value).find((d) => d.id === dsoId.value)
    : undefined;
});
const name = computed(
  () => dso.value?.displayName || dso.value?.catalogs[0] || dso.value?.id || '',
);

// The night of the search (its date, else tonight, at the search's place), resolved as a plan of this one target; a
// multiple star by its position.
const night = computed(() => {
  const d = dso.value;
  if (!d) return null;
  const entry = isStar.value
    ? { id: d.id, dsoId: null, ra: d.ra, dec: d.dec }
    : { id: d.id, dsoId: d.id, ra: null, dec: null };
  return resolvePlanNight({ entries: [entry] }, prefs.value, planLookups);
});
const info = computed(() => night.value?.infos[0] ?? null);
const setup = computed(() =>
  gear.value ? resolveSetupById(prefs.value.setupId, gear.value) : null,
);
const scores = computed(() =>
  info.value && dso.value && preset.value
    ? scorePlanEntry(dso.value, preset.value, info.value.maxAltDeg, prefs.value)
    : null,
);

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    ready.value = true;
    gear.value = await loadGearLists();
    await plans.load();
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

// The map goes back to this page, or to the page of the object its frame was moved onto, in the same list.
const targetPage = (id: string) =>
  `${planId ? `/plans/${planId}/targets` : '/targets'}/${encodeURIComponent(id)}`;
const showTargetOnMap = useShowTargetOnMap({
  tab: planId ? 'plans' : 'targets',
  pages: planId ? [`/plans/${planId}`, `/plans/${planId}/targets`] : [],
  page: targetPage(dsoId.value),
  pageOf: targetPage,
});
async function showOnMap() {
  if (dso.value) await showTargetOnMap(dso.value, prefs.value.setupId);
}

/** The target is in the plan already: "Ajouter au plan" is greyed. A multiple star is a frame of its own each time. */
const inPlan = computed(() =>
  planId && !isStar.value ? plans.isInPlan(dsoId.value, planId) : false,
);
/**
 * "Ajouter au plan": adds the target to this plan, the only choice here, and says so. A multiple star is not in the
 * catalogue: it is added as a frame on its position (the picker's addStar).
 */
async function addToPlan() {
  const p = plan.value;
  const d = dso.value;
  if (!p || !d || inPlan.value) return;
  if (isStar.value) {
    if ((await plans.addCustomEntry(p.id, d.ra, d.dec)) === null) return;
  } else {
    await plans.addEntry(p.id, d.id);
    // the store reports a failure itself; nothing is said then
    if (!plans.isInPlan(d.id, p.id)) return;
  }
  void showNotice(t('targets.plan.addedToPlan', { name: p.name }));
}

const pickerOpen = ref(false);
const pickerTarget = computed(() => ({
  id: dsoId.value,
  name: name.value,
  ra: dso.value?.ra ?? 0,
  dec: dso.value?.dec ?? 0,
  star: isStar.value,
}));
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="planId ? `/plans/${planId}/targets` : '/tabs/targets'" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ name }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="dso" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <TargetSummary
          :dso="dso"
          :info="info"
          :night="night"
          :scores="scores"
          :filters-subtitle="setup ? `${name} · ${setup.name}` : name"
        />
        <IonList class="mob-list" lines="none" style="padding-top: var(--space-7)">
          <PhoneRow
            :title="t('targets.plan.showOnMap')"
            :lead="mapPinIcon"
            button
            @click="showOnMap"
          />
          <PhoneRow
            v-if="planId"
            :title="t('targets.plan.pickerTitle')"
            :lead="listPlusIcon"
            :disabled="!plan || inPlan"
            button
            @click="addToPlan"
          />
          <PhoneRow
            v-else
            :title="t('targets.plan.addToPlan')"
            :lead="listPlusIcon"
            button
            @click="pickerOpen = true"
          />
        </IonList>
      </div>
    </IonContent>
    <PlanPickerSheet v-if="!planId" v-model:open="pickerOpen" :target="pickerTarget" />
  </IonPage>
</template>
