<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { fracToClock } from '@myastrosky/core/observation-windows';
import { PLAN_SORT_KEYS, type PlanSortKey } from '@myastrosky/core/domain/plans';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { planItemCount, resolvePlanNight } from '@myastrosky/core/targets/plan';
import {
  deletePlanAPI,
  renamePlanAPI,
  reorderPlanEntriesAPI,
  type Plan,
} from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PlanSetupField from './plans/PlanSetupField.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneReorderList from '../components/PhoneReorderList.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import PlanActionsSheet from './plans/PlanActionsSheet.vue';
import PlanRenameSheet from './plans/PlanRenameSheet.vue';
import moreIcon from '../icons/more-vertical.svg?raw';
import chevronIcon from '../icons/chevron-right.svg?raw';

// The boards "Détail du plan", "Plan, actions" and "Plan, confirmer la suppression": the night of the plan, then its
// plan's equipment (a field: choosing another may ask about its mosaics, board "Ciel, changer d'équipement"), then its
// targets in the plan's order, each with its first observation window. A tap opens the target; a drag
// by its handle puts it elsewhere (one request). The actions rename the plan, choose how its targets are sorted (the
// desktop's sorts) and delete it. Adding a target needs the targets list to pick from, which cannot add to a plan yet.
const route = useRoute();
const router = useRouter();
const store = usePlansStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const planId = computed(() => String(route.params.id));
const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === planId.value));
const actionsOpen = ref(false);
const renameOpen = ref(false);
const sortOpen = ref(false);
/** The order a hand drag gave, until the page is entered again. */
const handOrder = ref<string[] | null>(null);

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

const rows = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const names = new Map<string, string>();
  const ids: string[] = [];
  if (night.value) {
    for (const info of night.value.infos) {
      ids.push(info.entryId);
      names.set(info.entryId, info.dso.displayName || info.dso.catalogs[0] || info.dso.id);
    }
  } else {
    for (const e of p.entries) {
      const dso = e.mosaicId || !e.dsoId ? undefined : planLookups.getDsoById(e.dsoId);
      if (!dso) continue;
      ids.push(e.id);
      names.set(e.id, dso.displayName || dso.catalogs[0] || dso.id);
    }
  }
  const order = handOrder.value;
  const ordered = order ? [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : ids;
  return ordered.map((id) => {
    const entry = p.entries.find((e) => e.id === id);
    const first = [...(entry?.observationWindows ?? [])].sort(
      (a, b) => a.startFrac - b.startFrac,
    )[0];
    const win = night.value?.win;
    const range =
      first && win
        ? `${fracToClock(first.startFrac, win)} – ${fracToClock(first.endFrac, win)}`
        : '';
    return { id, name: names.get(id) ?? id, range };
  });
});

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    await store.load();
    handOrder.value = null;
  } catch (error) {
    void showError(error);
  }
}
void load();
onIonViewWillEnter(load);

async function onReorder(ids: string[]) {
  const previous = handOrder.value;
  handOrder.value = ids;
  try {
    await reorderPlanEntriesAPI(planId.value, ids);
    await store.load();
  } catch (error) {
    handOrder.value = previous;
    void showError(error);
  }
}

/** The desktop's sorts of a plan's targets, in its order. */
const SORT_LABELS: Record<PlanSortKey, string> = {
  transit: 'targets.sort.transit',
  altitude: 'targets.sort.altitude',
  rating: 'targets.sort.rating',
  magnitude: 'targets.sort.magnitude',
  size: 'targets.sort.size',
  name: 'targets.sort.name',
  difficulty: 'targets.sort.difficulty',
  window: 'targets.sort.window',
};
const sortOptions = computed(() =>
  PLAN_SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABELS[key]) })),
);
const sortKey = computed<PlanSortKey>({
  get: () => plan.value?.sortBy ?? 'transit',
  set: (key) => {
    // A hand order no longer applies once a sort is chosen.
    handOrder.value = null;
    if (plan.value) store.setPlanSort(plan.value.id, key);
  },
});

function openRename() {
  actionsOpen.value = false;
  renameOpen.value = true;
}

function openSort() {
  actionsOpen.value = false;
  sortOpen.value = true;
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
        <div style="background: var(--bg-panel)">
          <PhoneReorderList
            :items="
              rows.map((r) => ({ id: r.id, handleLabel: t('mobile.plans.drag', { name: r.name }) }))
            "
            openable
            @reorder="onReorder"
            @open="(id) => router.push(`/plans/${planId}/${id}`)"
          >
            <template #default="{ id }">
              <template v-for="row in rows.filter((r) => r.id === id)" :key="row.id">
                <span class="mob-row-body">
                  <span class="mob-row-title m-body">{{ row.name }}</span>
                  <span v-if="row.range" class="mob-row-sub m-secondary">
                    <span class="m-mono">{{ row.range }}</span>
                  </span>
                </span>
                <span class="mob-row-trail">
                  <span class="mob-row-chevron" aria-hidden="true"
                    ><AppIcon :svg="chevronIcon"
                  /></span>
                </span>
              </template>
            </template>
          </PhoneReorderList>
        </div>
      </div>
      <!-- Adding a target is done from the Cibles list, which cannot add to a plan yet (a later card): drawn, no tap. -->
      <PhoneFab :label="t('mobile.plans.addTarget')" flush waiting />
    </IonContent>
    <PlanActionsSheet
      v-if="plan"
      v-model:open="actionsOpen"
      :name="plan.name"
      :sort-label="t(SORT_LABELS[sortKey])"
      @rename="openRename"
      @sort="openSort"
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
