<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatAlt, formatDec, formatRA } from '@myastrosky/core/format-utils';
import { formatPaDeg } from '@myastrosky/core/frame-orientation';
import { fovDeg, formatFov } from '@myastrosky/core/gear-presets';
import { recommendRecipe } from '@myastrosky/core/imaging-recipe';
import { outlineFromGrid } from '@myastrosky/core/mosaic';
import { maxAltDuringWindow } from '@myastrosky/core/sky-geometry';
import { formatClock24, formatHours } from '@myastrosky/core/targets/format';
import { moonSeparationRating, resolvePlanNight } from '@myastrosky/core/targets/plan';
import {
  presetForSetupId,
  resolveSetupById,
  type GearLists,
} from '@myastrosky/core/targets/plan-setup';
import {
  updatePlanMosaicWindowsAPI,
  type ObservationWindow,
  type Plan,
} from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { usePlanOnMap } from '../composables/usePlanOnMap';
import { usePlanWindows } from '../composables/usePlanWindows';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import PhoneAltChart from '../components/PhoneAltChart.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import ObsWindowSheet from './plans/ObsWindowSheet.vue';
import gridIcon from '../icons/mosaic-grid.svg?raw';
import mapPinIcon from '@icons/map-pin.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Plan, détail d'une mosaïque" and "Plan, mosaïque, détail des panneaux": what the desktop shows of a plan's
// mosaic (its row in the plan), for the plan's night and setup. Under the name, the tiles × a tile's field → the
// mosaic's field; its figures at its centre (computable ones only: a mosaic has no catalogue fields), the total time of
// the target's recipe for every tile; the trajectory of its centre with its own observation windows (one set for the
// whole mosaic, `usePlanWindows`); each tile's figures in a sheet; showing it on the map (the plan, zoomed to fit the
// mosaic) and deleting it with its tiles.
const route = useRoute();
const router = useRouter();
const store = usePlansStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const { showMosaic } = usePlanOnMap();

const planId = computed(() => String(route.params.id));
const mosaicId = computed(() => String(route.params.mosaicId));
const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === planId.value));
const mosaic = computed(() => plan.value?.mosaics.find((m) => m.id === mosaicId.value));
const tiles = computed(() =>
  (plan.value?.entries ?? [])
    .filter((e) => e.mosaicId === mosaicId.value)
    .sort((a, b) => a.position - b.position),
);
const gear = shallowRef<GearLists | null>(null);
const panelsOpen = ref(false);

const night = computed(() =>
  plan.value ? resolvePlanNight(plan.value, targetsPrefs, planLookups) : null,
);
const info = computed(() => night.value?.infos.find((i) => i.mosaicId === mosaicId.value));
const name = computed(() => {
  const d = info.value?.dso;
  return d?.displayName || d?.catalogs[0] || mosaic.value?.name || '';
});
const title = computed(() => `${name.value} · ${t('targets.plan.mosaicLabel')}`);

const setupId = computed(() => plan.value?.setupId ?? targetsPrefs.setupId);
const setup = computed(() => (gear.value ? resolveSetupById(setupId.value, gear.value) : null));
const preset = computed(() => (gear.value ? presetForSetupId(setupId.value, gear.value) : null));

/** "N tuiles", then "× a tile's field → the mosaic's field" once the setup gives the tile's size. */
const geometry = computed(() => {
  const m = mosaic.value;
  if (!m) return '';
  const count = `${tiles.value.length} ${t('fovOverlay.mosaicPanels')}`;
  if (!preset.value) return count;
  const { wDeg, hDeg } = fovDeg(preset.value);
  const env = outlineFromGrid(m.cols, m.rows, wDeg, hDeg, m.overlapPct);
  return `${count} × ${formatFov(wDeg, hDeg)} → ${formatFov(env.wDeg, env.hDeg)}`;
});

const facts = computed(() => {
  const m = mosaic.value;
  const i = info.value;
  const n = night.value;
  const out: {
    label: string;
    value: string;
    tone?: 'success' | 'warn' | 'danger';
    mono?: boolean;
  }[] = [];
  if (!m) return out;
  if (i) {
    out.push({ label: t('targets.results.maxAlt'), value: formatAlt(i.maxAltDeg) });
    out.push({ label: t('targets.results.bestTime'), value: formatClock24(i.bestTimeUtc) });
    if (n && i.moonSepDeg !== null) {
      const rating = moonSeparationRating(i.moonSepDeg, n.phase.illum);
      out.push({
        label: t('targets.plan.moonSeparation'),
        value: `${t(rating.labelKey)} (${formatAlt(i.moonSepDeg)})`,
        tone: rating.level === 'ok' ? 'success' : rating.level,
      });
    }
  }
  out.push({ label: t('fovOverlay.angleLabel'), value: formatPaDeg(m.paDeg) });
  out.push({ label: t('mobile.plans.ra'), value: formatRA(m.centerRa), mono: true });
  out.push({ label: t('mobile.plans.dec'), value: formatDec(m.centerDec), mono: true });
  // The recipe needs a catalogue object: a mosaic on empty sky has none.
  const dso = m.dsoId ? planLookups.getDsoById(m.dsoId) : undefined;
  if (dso && preset.value) {
    const recipe = recommendRecipe(dso, preset.value);
    out.push({
      label: t('targets.results.integrationTotal'),
      value: formatHours(recipe.totalHours * tiles.value.length),
    });
  }
  return out;
});

/** Each tile's figures, as the desktop's per-panel table: its highest altitude over the night, angle and centre. */
const panels = computed(() => {
  const m = mosaic.value;
  const n = night.value;
  if (!m) return [];
  return tiles.value
    .filter((e) => e.ra != null && e.dec != null)
    .map((e, index) => {
      const alt = n
        ? maxAltDuringWindow(e.ra!, e.dec!, n.loc.latDeg, n.loc.lonDeg, n.win.start, n.win.end, 10)
            .maxAltDeg
        : null;
      const figures = [
        alt !== null ? `${t('targets.results.maxAlt')} ${formatAlt(alt)}` : '',
        `${t('fovOverlay.angleLabel')} ${formatPaDeg(e.paDeg ?? m.paDeg)}`,
      ].filter(Boolean);
      return {
        id: e.id,
        title: `${t('targets.plan.panelColumn')} ${index + 1}`,
        subs: [
          `${t('mobile.plans.ra')} ${formatRA(e.ra!)} · ${t('mobile.plans.dec')} ${formatDec(e.dec!)}`,
          figures.join(' · '),
        ],
      };
    });
});

/** Writes the mosaic's whole list of windows (one request) and reads the plans again. */
async function saveWindows(next: ObservationWindow[]) {
  await updatePlanMosaicWindowsAPI(planId.value, mosaicId.value, next);
  await store.load();
}

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
  stored: () => mosaic.value?.observationWindows ?? [],
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

// The desktop's "Afficher sur la carte" of a mosaic: the plan's frames, the map zoomed so the whole mosaic fits; the map
// comes back to this page, above the plan's.
async function showOnMap() {
  const p = plan.value;
  const m = mosaic.value;
  if (!p || !m) return;
  await showMosaic(p, m, `/plans/${p.id}/mosaics/${m.id}`, [`/plans/${p.id}`]);
}

async function remove() {
  const sure = await confirm({
    title: t('fovOverlay.deleteMosaic'),
    message: t('fovOverlay.deleteFrameConfirm', { name: name.value }),
    confirmLabel: t('fovOverlay.deleteMosaic'),
    destructive: true,
  });
  if (!sure) return;
  await store.deleteMosaic(planId.value, mosaicId.value);
  if (window.history.state?.back) router.back();
  else await router.replace(`/plans/${planId.value}`);
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="`/plans/${planId}`" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ mosaic ? title : '' }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="mosaic" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <div class="mob-sheet-header" style="padding-top: var(--space-7)">
          <div class="mob-meta m-secondary">
            <span class="m-mono">{{ geometry }}</span>
          </div>
        </div>
        <PhoneFacts :facts="facts" />
        <PhoneAltChart
          v-if="info && night"
          :curve="info.curve"
          :win="night.win"
          :best-time="info.bestTimeUtc"
          :max-alt-deg="info.maxAltDeg"
          :moon-curve="night.moon?.curve"
          :windows="chartWindows"
        />
        <IonList class="mob-list" lines="none">
          <PhoneRow
            :title="t('targets.plan.panelDetails')"
            :lead="gridIcon"
            chevron
            button
            :disabled="panels.length === 0"
            @click="panelsOpen = true"
          />
        </IonList>
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
            :title="t('fovOverlay.deleteMosaic')"
            :lead="trashIcon"
            danger
            button
            @click="remove"
          />
        </IonList>
      </div>
    </IonContent>
    <PhoneSheet
      v-model:open="panelsOpen"
      :title="t('targets.plan.panelDetailsTitle')"
      :subtitle="mosaic ? title : ''"
    >
      <IonList class="mob-list" lines="none">
        <PhoneRow v-for="p in panels" :key="p.id" :title="p.title" :subs="p.subs" mono />
      </IonList>
    </PhoneSheet>
    <ObsWindowSheet
      v-model:open="editorOpen"
      :window="editing"
      :subtitle="setup ? `${title} · ${setup.name}` : title"
      :night="night?.win ?? null"
      :is-new="isNew"
      @save="saveWindow"
      @delete="deleteWindow"
      @add-filter="addFilter"
    />
  </IonPage>
</template>
