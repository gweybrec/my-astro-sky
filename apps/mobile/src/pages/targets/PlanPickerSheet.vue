<script setup lang="ts">
import { watch } from 'vue';
import { IonList } from '@ionic/vue';
import { getLang, t } from '@myastrosky/core/i18n/index';
import { defaultPlanName } from '@myastrosky/core/targets/plan';
import { todayISO } from '@myastrosky/core/targets/format';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { useErrorToast } from '../../composables/useErrorToast';
import { targetsPrefs } from '../../composables/useTargets';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import plusIcon from '@icons/plus.svg?raw';

// The desktop's "Ajouter au plan" picker, in a sheet (the Cibles target page and the map's object sheet): the plans,
// ticked where the target is, a tap adds or removes it; "Nouveau plan" makes one holding it, named after the night
// searched. A multiple star (`star`) is added as a frame on its position, without ticks, as the desktop does.
const props = defineProps<{
  target: { id: string; name: string; ra: number; dec: number; star?: boolean };
}>();
const open = defineModel<boolean>('open', { required: true });
const plans = usePlansStore();
const { showNotice } = useErrorToast();

// The plans may have changed elsewhere: they are read again each time the sheet opens, as the desktop's picker does.
watch(open, (isOpen) => {
  if (isOpen) void plans.load();
});

async function toggle(planId: string) {
  const plan = plans.plans.find((p) => p.id === planId);
  if (!plan) return;
  const wasIn = plans.isInPlan(props.target.id, planId);
  await plans.toggleEntry(planId, props.target.id);
  void showNotice(
    t(wasIn ? 'targets.plan.removedFromPlan' : 'targets.plan.addedToPlan', { name: plan.name }),
  );
}
// The plan does not hold the star as such: added only, never ticked.
async function addStar(planId: string) {
  const plan = plans.plans.find((p) => p.id === planId);
  if (!plan) return;
  open.value = false;
  if (await plans.addCustomEntry(planId, props.target.ra, props.target.dec)) {
    void showNotice(t('targets.plan.addedToPlan', { name: plan.name }));
  }
}

async function addToNewPlan() {
  const id = await plans.createPlan(
    defaultPlanName(targetsPrefs.lastDateISO ?? todayISO(), t, getLang()),
  );
  if (!id) return;
  if (props.target.star) {
    await addStar(id);
    return;
  }
  await plans.addEntry(id, props.target.id);
  const plan = plans.plans.find((p) => p.id === id);
  if (plan) void showNotice(t('targets.plan.addedToPlan', { name: plan.name }));
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.plan.pickerTitle')" :subtitle="target.name">
    <IonList v-if="target.star" class="mob-list" lines="none">
      <PhoneRow
        v-for="plan in plans.plans"
        :key="plan.id"
        :title="plan.name"
        button
        @click="addStar(plan.id)"
      />
    </IonList>
    <PhoneCheckRow
      v-for="plan in target.star ? [] : plans.plans"
      :key="plan.id"
      :title="plan.name"
      :model-value="plans.isInPlan(target.id, plan.id)"
      @update:model-value="toggle(plan.id)"
    />
    <IonList class="mob-list" lines="none">
      <PhoneRow :title="t('targets.plan.newPlan')" :lead="plusIcon" button @click="addToNewPlan" />
    </IonList>
  </PhoneSheet>
</template>
