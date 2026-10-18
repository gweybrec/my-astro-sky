<script setup lang="ts">
import { onMounted } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSetupLines } from '../../composables/useSetupLines';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneRow from '../../components/PhoneRow.vue';
import plusIcon from '@icons/plus.svg?raw';

// The gear setups to choose one from (the desktop's setup picker), each with its gear and its field, then
// "Nouveau setup", which opens the setup editor.
defineProps<{ exclude?: (setupId: string) => boolean }>();
const emit = defineEmits<{ pick: [setupId: string]; add: [] }>();
const { lines, load } = useSetupLines();
const { showError } = useErrorToast();
onMounted(() => load().catch((error) => void showError(error)));
</script>

<template>
  <template v-for="line in lines" :key="line.setup.id">
    <PhoneRow
      v-if="!exclude?.(line.setup.id)"
      :title="line.setup.name"
      :subs="line.subs.slice(0, 1)"
      button
      @click="emit('pick', line.setup.id)"
    />
  </template>
  <PhoneRow :title="t('fovOverlay.newSetup')" :lead="plusIcon" button @click="emit('add')" />
</template>
