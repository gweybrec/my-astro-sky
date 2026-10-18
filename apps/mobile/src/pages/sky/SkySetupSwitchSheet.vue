<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Plan } from '@myastrosky/core/domain/plans';
import {
  commitSetupSwitch,
  switchProposalText,
  type SwitchDecision,
  type SwitchItem,
} from '@myastrosky/app-state/setup-switch';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSegmented from '../../components/PhoneSegmented.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';

// The board "Ciel, changer d'équipement": the desktop's setup-switch confirmation (setup-switch.ts
// openSetupSwitchModal) as a sheet over "Contours de champ". The plan's new setup does not fit some of its mosaics as
// they are: each one shows its proposed conversion and the choice Appliquer / Supprimer. OK (greyed until every mosaic
// has its choice) saves the setup, then applies or drops each mosaic; closing the sheet keeps the old setup.
const props = defineProps<{ plan: Plan; setupId: string; items: SwitchItem[] }>();
const open = defineModel<boolean>('open', { required: true });
const { showError } = useErrorToast();

const decisions = reactive(new Map<string, SwitchDecision>());
watch(open, (isOpen) => {
  if (isOpen) decisions.clear();
});
const choices = computed(() => [
  { value: 'apply' as const, label: t('fovOverlay.switchApply') },
  { value: 'drop' as const, label: t('fovOverlay.switchDrop') },
]);
const choice = (id: string) =>
  computed({
    get: () => decisions.get(id),
    set: (d: SwitchDecision | undefined) => d && decisions.set(id, d),
  });
const rows = computed(() =>
  props.items.map((item) => ({
    item,
    proposal: switchProposalText(item.transform),
    decision: choice(item.id),
  })),
);

const saving = ref(false);
const complete = computed(() => props.items.every((i) => decisions.has(i.id)));
async function confirm() {
  if (!complete.value || saving.value) return;
  saving.value = true;
  try {
    await commitSetupSwitch(props.plan, props.setupId, props.items, decisions);
    open.value = false;
  } catch (error) {
    await showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('fovOverlay.switchSetupTitle')" tall>
    <PhoneHelper>{{ t('fovOverlay.switchSetupIntro') }}</PhoneHelper>
    <div class="mob-panel">
      <template v-for="row in rows" :key="row.item.id">
        <PhoneRow :title="row.item.label" :subs="[row.proposal]" />
        <PhoneSegmented v-model="row.decision.value" :options="choices" :label="row.item.label" />
      </template>
    </div>
    <template #footer>
      <PhoneButton size="lg" @click="open = false">{{ t('targets.gear.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!complete || saving" @click="confirm">{{
        t('fovOverlay.switchConfirm')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
