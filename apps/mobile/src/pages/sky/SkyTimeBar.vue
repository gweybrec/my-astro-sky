<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import playIcon from '../../icons/play.svg?raw';
import pauseIcon from '../../icons/pause.svg?raw';

// The time bar of the boards "Ciel" and "Ciel, premier démarrage": the date and time of the sky shown (a tap opens the
// phone's date picker, then its time picker), "Ce soir" (the end of twilight of the day shown) and play / pause. They do
// what the desktop's time controls do: each one switches the map to the date mode, where the clock runs from the
// chosen moment. In the live mode the field shows the present time.
const time = useSkyTimeStore();
const { mode, simDate, paused } = storeToRefs(time);

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The live sky is the one of this minute.
const LIVE_REFRESH_MS = 15000;
const now = ref(new Date());
const refresh = setInterval(() => (now.value = new Date()), LIVE_REFRESH_MS);
onBeforeUnmount(() => clearInterval(refresh));

const shown = computed(() => (mode.value === 'date' ? simDate.value : now.value));
const dateValue = computed(() => dateOf(shown.value));
const clockValue = computed(() => clockOf(shown.value));
const label = computed(() => `${dateValue.value} ${clockValue.value}`);

// The picker is the phone's own: one date and time input, opened from the field.
const picker = ref<InstanceType<typeof IonInput> | null>(null);
const pickerValue = computed(() => `${dateValue.value}T${clockValue.value}`);

async function openPicker() {
  const native = await picker.value?.$el?.getInputElement?.();
  native?.showPicker?.();
}

function openPickers() {
  // Entering the date mode here is what the desktop does when its date button is pressed.
  if (mode.value !== 'date') time.setMode('date');
  void openPicker();
}

function onPicked(value: string | null | undefined) {
  const [date, clock] = (value ?? '').split('T');
  if (!date) return;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (clock || '00:00').split(':').map(Number);
  time.setSimDate(new Date(y, m - 1, d, hh, mm));
}
</script>

<template>
  <div class="mob-timebar">
    <PhoneButton
      variant="field"
      :aria-label="t('mobile.sky.dateField', { value: label })"
      @click="openPickers"
    >
      <span class="mob-btn-label">{{ label }}</span>
      <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
    </PhoneButton>
    <PhoneButton @click="time.jumpToEvening()">{{ t('mobile.sky.tonight') }}</PhoneButton>
    <PhoneIconButton
      :label="paused ? t('skyTime.play') : t('skyTime.stop')"
      @click="time.togglePaused()"
    >
      <AppIcon :svg="paused ? playIcon : pauseIcon" />
    </PhoneIconButton>
    <!-- Only the phone's picker behind this input is used: it sits in a box that takes no room. -->
    <span class="mob-picker-inputs">
      <IonInput
        ref="picker"
        type="datetime-local"
        tabindex="-1"
        :aria-hidden="true"
        :value="pickerValue"
        @ion-change="onPicked($event.detail.value)"
      />
    </span>
  </div>
</template>
