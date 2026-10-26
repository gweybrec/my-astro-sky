<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { ALL_DSO_TYPES } from '@myastrosky/core/targets/filters';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import { targetsPrefs, updateTargetsPrefs } from '../../composables/useTargets';

// The board "Cibles, types d'objets": "Tous" and one tick box per object type. Each change is stored at once;
// "Réinitialiser" ticks every type again and "Appliquer" closes the sheet (the list is searched again then).
const open = defineModel<boolean>('open', { required: true });

const enabled = computed(() => new Set(targetsPrefs.enabledTypes ?? ALL_DSO_TYPES));
const allOn = computed(() => enabled.value.size === ALL_DSO_TYPES.length);

function setType(type: string, on: boolean) {
  const next = new Set(enabled.value);
  if (on) next.add(type);
  else next.delete(type);
  updateTargetsPrefs({ enabledTypes: ALL_DSO_TYPES.filter((x) => next.has(x)) });
}

function setAll(on: boolean) {
  updateTargetsPrefs({ enabledTypes: on ? [...ALL_DSO_TYPES] : [] });
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.typeFilter')" tall>
    <PhoneCheckRow
      :title="t('mobile.targets.all')"
      :model-value="allOn"
      @update:model-value="setAll"
    />
    <PhoneCheckRow
      v-for="type in ALL_DSO_TYPES"
      :key="type"
      :title="t(`dso.typeLabels.${type}`)"
      :model-value="enabled.has(type)"
      @update:model-value="setType(type, $event)"
    />
    <template #footer>
      <PhoneButton size="lg" @click="setAll(true)">{{ t('mobile.targets.reset') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="open = false">{{
        t('mobile.targets.apply')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
