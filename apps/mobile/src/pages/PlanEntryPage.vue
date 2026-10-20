<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { catalogFilterColor } from '@myastrosky/core/gear-catalog';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatPaDeg } from '@myastrosky/core/frame-orientation';
import {
  fracToClock,
  framesInWindow,
  newObservationWindow,
} from '@myastrosky/core/observation-windows';
import { filterCssKey } from '@myastrosky/core/filter-keys';
import { buildSetupSummary } from '@myastrosky/core/setup-info';
import { formatArcmin, formatClock24, formatHours } from '@myastrosky/core/targets/format';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import {
  moonSeparationRating,
  resolvePlanNight,
  scorePlanEntry,
} from '@myastrosky/core/targets/plan';
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
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneBadge from '../components/PhoneBadge.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import ObsWindowSheet from './plans/ObsWindowSheet.vue';
import diamondIcon from '../icons/diamond.svg?raw';
import filterIcon from '../icons/filter.svg?raw';
import mapPinIcon from '@icons/map-pin.svg?raw';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Plan, détail d'une cible" and "Plan, fenêtre d'observation": the target's figures for the plan's night
// and setup, its suggested filters (board "Plan, cible, filtres suggérés": the desktop's recipe, a sheet), its
// observation windows (a tap opens one; the plus adds one) and the removal of the target from the plan.
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

const typeLabel = computed(() => {
  const d = dso.value;
  if (!d) return '';
  return d.type === 'MS' && d.multiplicity
    ? formatMultiplicity(d.multiplicity, t)
    : t(`dso.types.${d.type}`);
});

const facts = computed(() => {
  const d = dso.value;
  const i = info.value;
  if (!d) return [];
  const out: {
    label: string;
    value: string;
    wide?: boolean;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    icon?: string;
  }[] = [];
  if (i) {
    out.push({ label: t('targets.results.maxAlt'), value: formatAlt(i.maxAltDeg) });
    out.push({ label: t('targets.results.bestTime'), value: formatClock24(i.bestTimeUtc) });
  }
  if (d.mag !== null) out.push({ label: t('stars.magnitude'), value: d.mag.toFixed(1) });
  if (d.majAxis) out.push({ label: t('targets.results.size'), value: formatArcmin(d.majAxis) });
  // Shown whenever the Moon is on (as the plan page's "Lune" fact); the phase is the night's, so a Moon that stays
  // below the horizon all night (no overlay) still gives its distance.
  if (i && night.value && i.moonSepDeg !== null) {
    const rating = moonSeparationRating(i.moonSepDeg, night.value.phase.illum);
    out.push({
      label: t('targets.plan.moonSeparation'),
      value: `${t(rating.labelKey)} (${formatAlt(i.moonSepDeg)})`,
      tone: rating.level === 'ok' ? 'success' : rating.level,
    });
  }
  if (d.rating !== null) {
    out.push({
      label: t('targets.ratingFilter'),
      value: '★'.repeat(d.rating) + '☆'.repeat(5 - d.rating),
      rating: true,
    });
  }
  if (d.difficulty !== null) {
    out.push({
      label: t('targets.sort.difficulty'),
      value: String(d.difficulty),
      icon: diamondIcon,
    });
  }
  out.push({
    label: t('fovOverlay.angleLabel'),
    value: entry.value?.paDeg != null ? formatPaDeg(entry.value.paDeg) : '—',
  });
  if (scores.value) {
    out.push({ label: t('targets.results.score'), value: `${scores.value.scorePct} %` });
    out.push({ label: t('targets.results.fov'), value: `${scores.value.fovFitPct} %` });
  }
  if (setup.value) {
    const gearLine = buildSetupSummary(setup.value.tel, setup.value.cam, setup.value.acc).gearLine;
    out.push({
      label: t('targets.gear.section'),
      value: `${setup.value.name} · ${gearLine}`,
      wide: true,
    });
  }
  if (scores.value) {
    out.push({
      label: t('targets.results.integrationTotal'),
      value: formatHours(scores.value.recipe.totalHours),
      wide: true,
    });
  }
  return out;
});

const readVar = (cssVar: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(cssVar);
/** A filter's colour dot: the catalogue filter's, else the filter band's text colour token (board). */
const filterColor = (filter: string | null | undefined) =>
  (filter && catalogFilterColor(filter)) || readVar(`--filter-${filterCssKey(filter)}-text`).trim();
/** The window's colour dot: the one chosen, else its filter's. */
const colorOf = (w: ObservationWindow) => w.color || filterColor(w.filter);

// The desktop's "Filtres suggérés" of the plan's row: each filter of the recipe with its exposures and hours.
const filtersOpen = ref(false);
const suggestedFilters = computed(() =>
  (scores.value?.recipe.filters ?? []).map((f) => ({
    name: f.name,
    value: `${f.count} × ${f.subSeconds} s = ${formatHours(f.hours)}`,
    color: filterColor(f.name),
  })),
);

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
        <div class="mob-sheet-header" style="padding-top: var(--space-7)">
          <div class="mob-meta m-secondary">
            <span v-if="dso.displayName">{{ dso.catalogs[0] || dso.id }}</span>
            <PhoneBadge kind="type">{{ typeLabel }}</PhoneBadge>
            <PhoneBadge v-if="dso.constellation" kind="const">{{
              dso.constellation.toUpperCase()
            }}</PhoneBadge>
          </div>
        </div>
        <PhoneFacts :facts="facts" />
        <IonList class="mob-list" lines="none">
          <PhoneRow
            :title="t('targets.results.filtersTitle')"
            :lead="filterIcon"
            chevron
            button
            :disabled="suggestedFilters.length === 0"
            @click="filtersOpen = true"
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
          <PhoneRow :title="t('targets.plan.showOnMap')" :lead="mapPinIcon" inert />
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
    <PhoneSheet
      v-model:open="filtersOpen"
      :title="t('targets.results.filtersTitle')"
      :subtitle="setup ? `${name} · ${setup.name}` : name"
    >
      <IonList class="mob-list" lines="none">
        <PhoneRow
          v-for="f in suggestedFilters"
          :key="f.name"
          :title="f.name"
          :value="f.value"
          :swatch="f.color"
          mono
        />
      </IonList>
    </PhoneSheet>
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
