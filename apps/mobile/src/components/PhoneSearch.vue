<script setup lang="ts">
import { ref } from 'vue';
import { IonButton, IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from './AppIcon.vue';
import closeIcon from '@icons/close-x.svg?raw';

// The search field of a top bar (`.mob-search`) on Ionic's input. With `clearable` it is wrapped (`.mob-search-wrap`)
// with the clear button at its right end, shown while there is text.
defineProps<{ placeholder: string; label: string; clearable?: boolean }>();
const model = defineModel<string>({ default: '' });
const input = ref<InstanceType<typeof IonInput> | null>(null);

/** Puts the cursor in the field (and so raises the keyboard). */
function focus() {
  void input.value?.$el.setFocus();
}
defineExpose({ focus });

function clear() {
  model.value = '';
  focus();
}
</script>

<template>
  <div v-if="clearable" class="mob-search-wrap">
    <IonInput
      ref="input"
      v-model="model"
      class="mob-search m-body"
      type="search"
      enterkeyhint="search"
      :placeholder="placeholder"
      :aria-label="label"
    />
    <IonButton
      v-if="model"
      fill="clear"
      class="mob-search-clear"
      :aria-label="t('mobile.sky.searchClear')"
      @click="clear"
    >
      <AppIcon :svg="closeIcon" />
    </IonButton>
  </div>
  <IonInput
    v-else
    ref="input"
    v-model="model"
    class="mob-search m-body"
    type="search"
    enterkeyhint="search"
    :placeholder="placeholder"
    :aria-label="label"
  />
</template>
