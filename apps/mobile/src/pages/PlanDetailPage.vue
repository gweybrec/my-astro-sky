<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { fracToClock } from '@myastrosky/core/observation-windows';
import { formatClock24 } from '@myastrosky/core/targets/format';
import type { GearLists } from '@myastrosky/core/targets/plan-setup';
import { planItemCount, resolvePlanNight } from '@myastrosky/core/targets/plan';
import { deletePlanAPI, reorderPlanEntriesAPI, type Plan } from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { catalogsReady } from '../catalogs';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { loadGearLists, planLookups } from '../composables/usePlans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneFacts from '../components/PhoneFacts.vue';
import PhoneReorderList from '../components/PhoneReorderList.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PlanActionsSheet from './plans/PlanActionsSheet.vue';
import moreIcon from '../icons/more-vertical.svg?raw';
import chevronIcon from '../icons/chevron-right.svg?raw';

// The boards "Détail du plan", "Plan, actions" and "Plan, confirmer la suppression": the night of the plan, then its
// targets in the plan's order, each with its first observation window and its setup. A tap opens the target; a drag
// by its handle puts it elsewhere (one request). Adding a target needs the targets list to pick from (a later card).
const route = useRoute();
const router = useRouter();
const store = usePlansStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const planId = computed(() => String(route.params.id));
const plan = computed<Plan | undefined>(() => store.plans.find((p) => p.id === planId.value));
const gear = shallowRef<GearLists | null>(null);
const actionsOpen = ref(false);
/** The order a hand drag gave, until the page is entered again. */
const handOrder = ref<string[] | null>(null);

const night = computed(() =>
  plan.value ? resolvePlanNight(plan.value, targetsPrefs, planLookups) : null,
);

const setupName = computed(() => {
  const id = plan.value?.setupId ?? targetsPrefs.setupId;
  return gear.value?.setups.find((s) => s.id === id)?.name;
});

const summary = computed(() => {
  const n = night.value;
  if (!n) return [];
  const facts: { label: string; value: string; wide?: boolean }[] = [
    { label: t('targets.plan.nightStart'), value: formatClock24(n.win.start) },
    { label: t('targets.plan.nightEnd'), value: formatClock24(n.win.end) },
  ];
  if (targetsPrefs.showMoon !== false) {
    facts.push({
      label: t('mobile.plans.moon'),
      value: `${t(`mobile.plans.phase${n.phase.phaseIndex}`)} · ${Math.round(n.phase.illum * 100)} %`,
      wide: true,
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
    return { id, name: names.get(id) ?? id, range, setup: setupName.value ?? '' };
  });
});

async function load() {
  try {
    reloadTargetsPrefs();
    await catalogsReady();
    await store.load();
    gear.value = await loadGearLists();
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
                  <span v-if="row.range || row.setup" class="mob-row-sub m-secondary">
                    <span v-if="row.range" class="m-mono">{{ row.range }}</span>
                    <template v-if="row.range && row.setup"> · </template>{{ row.setup }}
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
      :sort-label="t(`targets.sort.${plan.sortBy ?? 'transit'}`)"
      @delete="remove"
    />
  </IonPage>
</template>
