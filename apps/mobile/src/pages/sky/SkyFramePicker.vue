<script setup lang="ts">
import { useRouter } from 'vue-router';
import { IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import { usePlansStore } from '@myastrosky/app-state/stores/plans';
import { newPlanName } from '../../frame-text';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import SkySetupRows from './SkySetupRows.vue';
import plusIcon from '@icons/plus.svg?raw';

// The board "Ciel, créer un cadre" (the desktop's frame picker, fov-overlay.ts openFramePicker), opened by "Ajouter un
// cadre" of the object sheet. "Ajouter à un plan": the object joins that plan (a star as a custom location) and the
// plan's frames are shown with "Contours de champ" open, as the desktop opens its frame manager. "Ajouter comme cadre
// libre": a free frame of that setup, pinned on the object and selected.
export interface FrameTarget {
  /** The deep-sky object's id, or null for a star (it becomes a custom location). */
  dsoId: string | null;
  ra: number;
  dec: number;
  name: string;
}
const props = defineProps<{ target: FrameTarget }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ plan: []; free: [] }>();
const fov = useFovFramesStore();
const plans = usePlansStore();
const router = useRouter();
const { showError } = useErrorToast();

const setupName = (setupId: string | null) => (setupId ? (fov.specs.get(setupId)?.name ?? '') : '');

async function addToPlan(planId: string | null) {
  open.value = false;
  try {
    const id = planId ?? (await plans.createPlan(newPlanName()));
    if (!id) return;
    const { dsoId, ra, dec } = props.target;
    if (dsoId) await plans.addEntry(id, dsoId);
    else await plans.addCustomEntry(id, ra, dec);
    fov.setFramesVisible(true);
    fov.setSelection({ kind: 'plan', planId: id });
    emit('plan');
  } catch (error) {
    await showError(error);
  }
}

function addFree(setupId: string) {
  open.value = false;
  const { dsoId, ra, dec } = props.target;
  fov.setFramesVisible(true);
  fov.addAdhocFrameAtSky(setupId, ra, dec, dsoId);
  emit('free');
}

function newSetup() {
  open.value = false;
  void router.push('/settings/setups/new');
}
</script>

<template>
  <PhoneSheet
    v-model:open="open"
    :title="t('fovOverlay.createFrameTitle')"
    :subtitle="target.name"
    tall
  >
    <PhoneSectionHeader>{{ t('targets.plan.addToPlan') }}</PhoneSectionHeader>
    <IonList class="mob-list" lines="none">
      <PhoneRow
        v-for="p in plans.plans"
        :key="p.id"
        :title="p.name"
        :subs="setupName(p.setupId) ? [setupName(p.setupId)] : []"
        button
        @click="addToPlan(p.id)"
      />
      <PhoneRow
        :title="t('targets.plan.newPlan')"
        :lead="plusIcon"
        button
        @click="addToPlan(null)"
      />
    </IonList>
    <PhoneSectionHeader>{{ t('fovOverlay.addFreeFrame') }}</PhoneSectionHeader>
    <IonList class="mob-list" lines="none">
      <SkySetupRows @pick="addFree" @add="newSetup" />
    </IonList>
  </PhoneSheet>
</template>
