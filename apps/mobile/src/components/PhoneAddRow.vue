<script setup lang="ts">
import { IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from './AppIcon.vue';
import PhoneButton from './PhoneButton.vue';
import plusIcon from '@icons/plus.svg?raw';

// A text field and its plus button on one line (`.mob-add-row`): what is typed is added by the button or by the
// keyboard's Done key. The default slot replaces the field (a readout that opens a list of choices).
defineProps<{ placeholder?: string; ariaLabel?: string; disabled?: boolean }>();
const emit = defineEmits<{ add: [] }>();
const model = defineModel<string>({ default: '' });
</script>

<template>
  <div class="mob-add-row">
    <slot>
      <IonInput
        v-model="model"
        class="mob-field m-body"
        type="text"
        enterkeyhint="done"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        @keydown.enter.prevent="emit('add')"
      />
    </slot>
    <PhoneButton
      icon
      :disabled="disabled"
      :aria-label="t('modal.metadataCaptureAddField')"
      @click="emit('add')"
    >
      <AppIcon :svg="plusIcon" />
    </PhoneButton>
  </div>
</template>
