<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { fracToClock } from '@myastrosky/core/observation-windows';
import type { PlanSortKey } from '@myastrosky/core/domain/plans';
import { formatClock24 } from '@myastrosky/core/targets/format';
import {
  customLocationLabelOr,
  planItemCount,
  resolvePlanNight,
} from '@myastrosky/core/targets/plan';
import { buildPlanPdfTargets } from '@myastrosky/core/targets/plan-pdf';
import { fovDeg } from '@myastrosky/core/gear-presets';
import { outlineFromGrid } from '@myastrosky/core/mosaic';
import { presetForSetupId, resolveSetupById } from '@myastrosky/core/targets/plan-setup';
import {
  deletePlanAPI,
  renamePlanAPI,
  type Plan,
  type PlanMosaic,
} from '@myastrosky/app-state/api';
import type { DSO } from '@myastrosky/core/types';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { skyPlanView } from '../sky-modes';
import { framesSheetOpen } from '../sky-frames';
import { openTab, swapPagesUnseen } from '../tab-navigation';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { withSkyMap } from '../sky-map-setup';
import { saveFile } from '../platform-device';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import { skyFocus } from '../composables/useSkySelection';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PlanSetupField from './plans/PlanSetupField.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import PlanActionsSheet from './plans/PlanActionsSheet.vue';
import PlanRenameSheet from './plans/PlanRenameSheet.vue';
import moreIcon from '../icons/more-vertical.svg?raw';
import sortIcon from '../icons/arrow-up-down.svg?raw';

// The boards "Détail du plan", "Plan, actions" and "Plan, confirmer la suppression": the night of the plan, then its
// plan's equipment (a field: choosing another may ask about its mosaics, board "Ciel, changer d'équipement"), then its
// targets in the plan's sort, each with its first observation window. A tap opens the target. The button beside the
// actions chooses the sort (the desktop's sorts; as there, no order by hand): the list is sorted again when this page
// is entered, after a target's windows were changed on its page. The actions rename the plan, export it as a PDF (the desktop's, through the share sheet) and delete it; "Afficher sur la carte" opens the map in a mode of its own on the plan's frames (the
// desktop selects the plan's frames and opens its frame manager), its back arrow returning here. The plus opens the Cibles list for this plan (boards "Plan, ajouter une cible"), as the
// desktop's "Trouver des cibles" of a plan; the targets added there show when this page is entered again. A mosaic is
// an item of the plan like a target (its name · Mosaïque, its number of tiles): sorted with them, a tap
// shows the plan on the map zoomed to fit it, as the desktop's "Afficher sur la carte" of a mosaic.
const route = useRoute();
const router = useRouter();
const store = usePlansStore();
const fov = useFovFramesStore();
const { confirm } = useConfirm();
const { showError, showNotice } = useErrorToast();

const planId = computed(() => String(route.params.id));
const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === planId.value));
const actionsOpen = ref(false);
const renameOpen = ref(false);
const sortOpen = ref(false);

const night = computed(() =>
  plan.value ? resolvePlanNight(plan.value, targetsPrefs, planLookups) : null,
);

const summary = computed(() => {
  const n = night.value;
  if (!n) return [];
  const facts: { label: string; value: string }[] = [
    { label: t('targets.plan.nightStart'), value: formatClock24(n.win.start) },
    { label: t('targets.plan.nightEnd'), value: formatClock24(n.win.end) },
  ];
  if (targetsPrefs.showMoon !== false) {
    facts.push({
      label: t('mobile.plans.moon'),
      value: `${t(`mobile.plans.phase${n.phase.phaseIndex}`)} · ${t('mobile.format.percent', { n: Math.round(n.phase.illum * 100) })}`,
    });
  }
  return facts;
});

/** The plan's items (targets and mosaics) in its sort when a location is known, else as stored. */
const rows = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const items: { id: string; name: string; mosaic?: PlanMosaic }[] = [];
  const mosaicOf = (id: string | undefined) => p.mosaics.find((m) => m.id === id);
  const label = (dso: DSO) => dso.displayName || dso.catalogs[0] || dso.id;
  if (night.value) {
    for (const info of night.value.infos) {
      items.push({ id: info.entryId, name: label(info.dso), mosaic: mosaicOf(info.mosaicId) });
    }
  } else {
    for (const e of p.entries) {
      const dso = e.mosaicId || !e.dsoId ? undefined : planLookups.getDsoById(e.dsoId);
      if (dso) items.push({ id: e.id, name: label(dso) });
    }
    for (const m of p.mosaics) {
      const dso = m.dsoId ? planLookups.getDsoById(m.dsoId) : undefined;
      const name =
        m.name ??
        (dso
          ? label(dso)
          : customLocationLabelOr(m.centerRa, m.centerDec, t('fovOverlay.customLocation')));
      items.push({ id: m.id, name, mosaic: m });
    }
  }
  const win = night.value?.win;
  return items.map(({ id, name, mosaic }) => {
    if (mosaic) {
      const tiles = p.entries.filter((e) => e.mosaicId === mosaic.id).length;
      return {
        id,
        title: `${name} · ${t('targets.plan.mosaicLabel')}`,
        sub: `${tiles} ${t('fovOverlay.mosaicPanels')}`,
        mono: false,
        mosaic,
      };
    }
    const entry = p.entries.find((e) => e.id === id);
    const first = [...(entry?.observationWindows ?? [])].sort(
      (a, b) => a.startFrac - b.startFrac,
    )[0];
    const range =
      first && win
        ? `${fracToClock(first.startFrac, win)} – ${fracToClock(first.endFrac, win)}`
        : '';
    return { id, title: name, sub: range, mono: true, mosaic: undefined };
  });
});

function openRow(id: string) {
  const mosaic = rows.value.find((r) => r.id === id)?.mosaic;
  if (mosaic) void showMosaicOnMap(mosaic);
  else void router.push(`/plans/${planId.value}/${id}`);
}

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    await store.load();
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

/** The desktop's sorts of a plan's targets, the most used first: the phone's list does not show them all at once. */
const SORT_LABELS: Record<PlanSortKey, string> = {
  window: 'targets.sort.window',
  transit: 'targets.sort.transit',
  altitude: 'targets.sort.altitude',
  rating: 'targets.sort.rating',
  size: 'targets.sort.size',
  name: 'targets.sort.name',
  magnitude: 'targets.sort.magnitude',
  difficulty: 'targets.sort.difficulty',
};
const sortOptions = computed(() =>
  (Object.keys(SORT_LABELS) as PlanSortKey[]).map((key) => ({
    value: key,
    label: t(SORT_LABELS[key]),
  })),
);
const sortKey = computed<PlanSortKey>({
  get: () => plan.value?.sortBy ?? 'transit',
  set: (key) => {
    if (plan.value) store.setPlanSort(plan.value.id, key);
  },
});

// The map's mode "voir un plan": the plan's frames shown, with the frames' sheet on them. The mode puts the frames back
// as they were when it ends.
async function showOnMap() {
  const p = plan.value;
  if (!p) return;
  actionsOpen.value = false;
  await openPlanOnMap(p);
}

// A mosaic of the plan: the plan on the map, zoomed so the whole mosaic fits (its outline as the field), as the
// desktop's navigateToMosaic. A smart telescope's mosaic is one enlarged frame, of its own size.
async function showMosaicOnMap(m: PlanMosaic) {
  const p = plan.value;
  if (!p) return;
  const setupId = p.setupId ?? targetsPrefs.setupId ?? null;
  if (setupId && !fov.specs.has(setupId)) await fov.loadSpecs();
  const spec = setupId ? fov.specs.get(setupId) : undefined;
  const tiles = p.entries.filter((e) => e.mosaicId === m.id);
  const own = tiles.length === 1 ? tiles[0] : undefined;
  const outline =
    own?.mosaicWDeg && own.mosaicHDeg
      ? { wDeg: own.mosaicWDeg, hDeg: own.mosaicHDeg }
      : spec
        ? outlineFromGrid(m.cols, m.rows, spec.wDeg, spec.hDeg, m.overlapPct)
        : null;
  skyFocus.value = outline
    ? { ra: m.centerRa, dec: m.centerDec, scale: 0, fov: outline }
    : { ra: m.centerRa, dec: m.centerDec, scale: 400 };
  await openPlanOnMap(p);
}

async function openPlanOnMap(p: Plan) {
  skyPlanView.value = {
    planId: p.id,
    name: p.name,
    frames: { visible: fov.framesVisible, selection: { ...fov.selection } },
    returnTo: `/plans/${p.id}`,
  };
  fov.setSelection({ kind: 'plan', planId: p.id });
  fov.setFramesVisible(true);
  // Its tab, then the map: out of sight, so that the tab is not glimpsed on the way. The sheet opens over the map.
  await swapPagesUnseen(() => openTab(router, 'plans', 'sky'));
  framesSheetOpen.value = true;
}

// The desktop's PDF of a plan: its targets and mosaics in the plan's order, the sky views drawn with the Ciel map; the
// file goes to the share sheet.
async function exportPdf() {
  const p = plan.value;
  const n = night.value;
  actionsOpen.value = false;
  if (!p) return;
  if (!n || n.infos.length === 0) {
    void showNotice(t('targets.plan.empty'));
    return;
  }
  void showNotice(t('settings.exportView.rendering'));
  try {
    const setupId = p.setupId ?? targetsPrefs.setupId ?? null;
    if (setupId && !fov.specs.has(setupId)) await fov.loadSpecs();
    const spec = setupId ? fov.specs.get(setupId) : undefined;
    const gear = setupId ? await loadGearLists() : null;
    const preset = gear ? presetForSetupId(setupId, gear) : null;
    const { renderPlanPdf } = await import('@myastrosky/render/plan-pdf');
    const options = {
      planName: p.name,
      targets: buildPlanPdfTargets(p, n, preset ? fovDeg(preset) : null),
      showCardinal: targetsPrefs.showCardinal !== false,
      fovSpecs: spec ? [{ label: spec.label, wDeg: spec.wDeg, hDeg: spec.hDeg }] : [],
      header: {
        nightOf: p.nightOf,
        latDeg: p.lat ?? targetsPrefs.lat ?? null,
        lonDeg: p.lon ?? targetsPrefs.lon ?? null,
      },
      setup: gear && setupId ? resolveSetupById(setupId, gear) : null,
    };
    const blob = await withSkyMap((map) => renderPlanPdf(map, options));
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await saveFile(`myastrosky-plan-${ts}.pdf`, blob);
  } catch (error) {
    void showError(error);
  }
}

function openRename() {
  actionsOpen.value = false;
  renameOpen.value = true;
}

async function rename(name: string) {
  try {
    await renamePlanAPI(planId.value, name);
    await store.load();
  } catch (error) {
    void showError(error);
  }
}

async function remove() {
  const p = plan.value;
  if (!p) return;
  actionsOpen.value = false;
  const sure = await confirm({
    title: t('targets.plan.delete'),
    message: t('targets.plan.confirmDelete', { name: p.name }),
    confirmLabel: t('targets.plan.delete'),
    destructive: true,
  });
  if (!sure) return;
  try {
    await deletePlanAPI(p.id);
    // The list reads the plans again when it is entered; leaving first keeps this page from drawing a plan that is gone.
    if (window.history.state?.back) router.back();
    else await router.replace('/tabs/plans');
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/plans" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ plan?.name }}</h1>
      <PhoneIconButton :label="t('targets.sort.label')" @click="sortOpen = true"
        ><AppIcon :svg="sortIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('mobile.plans.actions')" @click="actionsOpen = true"
        ><AppIcon :svg="moreIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="plan" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <template v-if="summary.length">
          <PhoneSectionHeader>{{ t('targets.plan.pdf.summary') }}</PhoneSectionHeader>
          <PhoneFacts :facts="summary" />
        </template>
        <PlanSetupField :plan="plan" bare @new-setup="router.push('/settings/setups/new')" />
        <PhoneSectionHeader>{{
          t('targets.plan.itemCount', { n: planItemCount(plan) })
        }}</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-for="row in rows"
            :key="row.id"
            :title="row.title"
            :subs="row.sub ? [row.sub] : []"
            :mono="row.mono"
            button
            chevron
            @click="openRow(row.id)"
          />
        </IonList>
      </div>
      <PhoneFab
        :label="t('mobile.plans.addTarget')"
        flush
        @click="router.push(`/plans/${planId}/targets`)"
      />
    </IonContent>
    <PlanActionsSheet
      v-if="plan"
      v-model:open="actionsOpen"
      :name="plan.name"
      @show-on-map="showOnMap"
      @rename="openRename"
      @export-pdf="exportPdf"
      @delete="remove"
    />
    <PlanRenameSheet v-if="plan" v-model:open="renameOpen" :name="plan.name" @rename="rename" />
    <PhoneRadioSheet
      v-model:open="sortOpen"
      v-model:value="sortKey"
      :title="t('targets.sort.label')"
      :options="sortOptions"
    />
  </IonPage>
</template>
