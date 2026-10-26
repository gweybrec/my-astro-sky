<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { todayISO } from '@myastrosky/core/targets/format';
import { defaultPlanName, formatPlanDate, planItemCount } from '@myastrosky/core/targets/plan';
import { createPlanAPI } from '@myastrosky/app-state/api';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { reloadTargetsPrefs, targetsPrefs } from '../composables/useTargets';
import { useErrorToast } from '../composables/useErrorToast';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneFab from '../components/PhoneFab.vue';
import plusIcon from '@icons/plus.svg?raw';
import planIcon from '@icons/plan-list.svg?raw';

// The Plans tab, from the boards "Plans" and "Plans, aucun plan": the observing plans, each with its night and its
// number of objects; a tap opens the plan, the plus (or the button of the empty screen) adds one.
const router = useRouter();
const store = usePlansStore();
const { showError } = useErrorToast();

const search = ref('');

// Without accents or case, as the other search fields of the app.
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const rows = computed(() => {
  const query = fold(search.value.trim());
  return store.plans
    .filter((plan) => !query || fold(plan.name).includes(query))
    .map((plan) => {
      const count = t('targets.plan.itemCount', { n: planItemCount(plan) });
      return {
        id: plan.id,
        name: plan.name,
        sub: plan.nightOf ? `${formatPlanDate(plan.nightOf, getLang())} · ${count}` : count,
      };
    });
});

async function load() {
  reloadTargetsPrefs();
  await store.load();
}
void load();
onIonViewWillEnter(load);

async function create() {
  try {
    await createPlanAPI(defaultPlanName(targetsPrefs.lastDateISO ?? todayISO(), t, getLang()));
    await store.load();
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        v-model="search"
        :placeholder="t('mobile.plans.searchPlaceholder')"
        :label="t('mobile.plans.searchLabel')"
      />
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <!-- Shown only once the backend has answered with no plan at all. -->
        <PhoneEmptyState
          v-if="store.loaded && store.plans.length === 0"
          :text="t('targets.plan.noPlans')"
          :button-label="t('targets.plan.newPlan')"
          :button-icon="plusIcon"
          @action="create"
        />
        <IonList v-else class="mob-list" lines="none" style="padding-top: var(--space-4)">
          <PhoneRow
            v-for="row in rows"
            :key="row.id"
            :title="row.name"
            :subs="[row.sub]"
            :lead="planIcon"
            button
            chevron
            @click="router.push(`/plans/${row.id}`)"
          />
        </IonList>
      </div>
      <PhoneFab
        v-if="store.plans.length > 0"
        in-tab
        :label="t('targets.plan.newPlan')"
        @click="create"
      />
    </IonContent>
  </IonPage>
</template>
