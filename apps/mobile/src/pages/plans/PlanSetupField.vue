<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Plan } from '@myastrosky/core/domain/plans';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import {
  setupSwitchItems,
  switchSetupDirectly,
  type SwitchItem,
} from '@myastrosky/app-state/setup-switch';
import { useErrorToast } from '../../composables/useErrorToast';
import { useSetupLines } from '../../composables/useSetupLines';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneRadioGroup from '../../components/PhoneRadioGroup.vue';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import AppIcon from '../../components/AppIcon.vue';
import SkySetupSwitchSheet from '../sky/SkySetupSwitchSheet.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// A plan's gear setup, as a field (the desktop's dropdown, with "Choisir un setup" while it has none): it opens the
// choice of a setup; a setup that does not fit the plan's mosaics as they are asks per mosaic (board "Ciel, changer
// d'équipement"). In "Ciel, contours de champ" the field shows its name beside the setup's; on "Détail du plan"
// (`bare`) the setup's name alone. "Nouveau setup" is the page's to open (`newSetup`).
const props = defineProps<{ plan: Plan; bare?: boolean }>();
const emit = defineEmits<{ newSetup: [] }>();
const { showError } = useErrorToast();
const fov = useFovFramesStore();

// The field's name: "Setup" beside the frames, "Équipement" on the plan's page (its board).
const fieldName = computed(() => t(props.bare ? 'targets.gear.section' : 'mobile.sky.planSetup'));
const { lines, load } = useSetupLines();
const pickOpen = ref(false);
const label = (id: string, name: string) => fov.specs.get(id)?.label ?? name;
const options = computed(() =>
  lines.value.map((l) => ({ value: l.setup.id, label: label(l.setup.id, l.setup.name) })),
);
const name = computed(() => {
  const id = props.plan.setupId;
  if (!id) return t('fovOverlay.pickSetup');
  return options.value.find((o) => o.value === id)?.label ?? fov.specs.get(id)?.label ?? '';
});
// The setups' names are read at once, so that the field names the plan's setup before it is opened.
load().catch((error) => void showError(error));

function openPick() {
  pickOpen.value = true;
  load().catch((error) => void showError(error));
}
function newSetup() {
  pickOpen.value = false;
  emit('newSetup');
}

const switchOpen = ref(false);
const switchTo = ref<{ setupId: string; items: SwitchItem[] } | null>(null);
const chosen = computed({
  get: () => props.plan.setupId ?? undefined,
  set: (id: string | undefined) => {
    pickOpen.value = false;
    const p = props.plan;
    if (!id || id === p.setupId) return;
    void (async () => {
      try {
        const items = await setupSwitchItems(p, id);
        if (items.length === 0) await switchSetupDirectly(p, id);
        else {
          switchTo.value = { setupId: id, items };
          switchOpen.value = true;
        }
      } catch (error) {
        await showError(error);
      }
    })();
  },
});
</script>

<template>
  <div class="mob-form-row mob-form-row--field">
    <PhoneButton
      variant="field"
      block
      text-style="body"
      :aria-label="`${fieldName} : ${name}`"
      @click="openPick"
    >
      <span v-if="bare" class="mob-btn-label">{{ name }}</span>
      <template v-else>
        <span class="mob-btn-key">{{ fieldName }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ name }}</span>
      </template>
      <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
    </PhoneButton>
  </div>
  <PhoneSheet v-model:open="pickOpen" :title="fieldName">
    <PhoneRadioGroup v-model="chosen" :options="options" :label="fieldName" />
    <PhoneRow :title="t('fovOverlay.newSetup')" :lead="plusIcon" button @click="newSetup" />
  </PhoneSheet>
  <SkySetupSwitchSheet
    v-if="switchTo"
    v-model:open="switchOpen"
    :plan="plan"
    :setup-id="switchTo.setupId"
    :items="switchTo.items"
  />
</template>
