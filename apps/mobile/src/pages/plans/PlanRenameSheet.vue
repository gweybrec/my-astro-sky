<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneButton from '../../components/PhoneButton.vue';

// "Renommer le plan": the plan's name in a field, with Annuler / Valider. As on the desktop, an empty or unchanged
// name is not saved.
const props = defineProps<{ name: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ rename: [name: string] }>();

const draft = ref('');
// The field starts from the stored name each time the sheet opens.
watch(
  open,
  (isOpen) => {
    if (isOpen) draft.value = props.name;
  },
  { immediate: true },
);

function validate() {
  const name = draft.value.trim();
  open.value = false;
  if (name && name !== props.name) emit('rename', name);
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('targets.plan.rename')">
    <PhoneField v-model="draft" :aria-label="t('targets.plan.rename')" />
    <template #footer>
      <PhoneButton size="lg" @click="open = false">{{ t('modal.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="validate">{{
        t('modal.validate')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
