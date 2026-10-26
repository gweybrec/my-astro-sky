<script setup lang="ts">
import { ref } from 'vue';
import { IonInput } from '@ionic/vue';

// The phone's own date or time picker, with nothing drawn: an input that takes no room, whose picker `open()` shows.
// The field or button that shows the value is the screen's; it calls `open()` on a tap and reads the choice from `pick`.
// The phone's picker also has a button that empties the value: that is `clear`, for a screen whose value may be none.
defineProps<{
  type: 'date' | 'time' | 'datetime-local';
  /** The value the picker starts on, in the input's own format (`2026-10-03`, `21:30`, `2026-10-03T21:30`). */
  value: string;
}>();
const emit = defineEmits<{ pick: [value: string]; clear: [] }>();

const input = ref<InstanceType<typeof IonInput> | null>(null);

async function open() {
  const native = await input.value?.$el?.getInputElement?.();
  native?.showPicker?.();
}
defineExpose({ open });

function onChange(value: string | number | null | undefined) {
  if (typeof value === 'string' && value) emit('pick', value);
  else emit('clear');
}
</script>

<template>
  <span class="mob-picker-inputs">
    <IonInput
      ref="input"
      :type="type"
      tabindex="-1"
      :aria-hidden="true"
      :value="value"
      @ion-change="onChange($event.detail.value)"
    />
  </span>
</template>
