<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonDatetime } from '@ionic/vue';
import { t, getLang } from '@myastrosky/core/i18n/index';
import { todayISO } from '@myastrosky/core/targets/format';
import PhoneSheet from './PhoneSheet.vue';
import PhoneButton from './PhoneButton.vue';

// The night of the search or of a plan, picked in Ionic's calendar (a day only, Monday first). As on the desktop, a
// night is replaced, never removed: "Aujourd'hui" picks today and closes, "Valider" the day chosen; "Annuler", the
// back button, the backdrop or dragging the sheet down keep the night it opened on.
const props = defineProps<{
  /** The night shown when the sheet opens, as `YYYY-MM-DD`. */
  value: string;
  title: string;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ pick: [dateISO: string] }>();

const draft = ref(props.value);
watch(open, (isOpen) => {
  if (isOpen) draft.value = props.value;
});

function onChange(value: string | string[] | null | undefined) {
  if (typeof value === 'string' && value) draft.value = value.slice(0, 10);
}

function choose(dateISO: string) {
  open.value = false;
  if (dateISO !== props.value) emit('pick', dateISO);
}
</script>

<template>
  <PhoneSheet v-model:open="open" :title="title">
    <IonDatetime
      class="mob-date-calendar"
      presentation="date"
      :value="draft"
      :locale="getLang()"
      :first-day-of-week="1"
      data-test="night-calendar"
      @ion-change="onChange($event.detail.value)"
    />
    <template #footer>
      <PhoneButton size="lg" data-test="night-today" @click="choose(todayISO())">{{
        t('gallery.sheet.today')
      }}</PhoneButton>
      <PhoneButton size="lg" data-test="night-cancel" @click="open = false">{{
        t('modal.cancel')
      }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" data-test="night-ok" @click="choose(draft)">{{
        t('modal.validate')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
