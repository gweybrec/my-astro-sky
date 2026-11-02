<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import SkyTimeSteppers from './SkyTimeSteppers.vue';
import caretIcon from '../../icons/chevron-down.svg?raw';
import caretUpIcon from '../../icons/chevron-up.svg?raw';
import playIcon from '../../icons/play.svg?raw';
import pauseIcon from '../../icons/pause.svg?raw';
import rewindIcon from '../../icons/rewind.svg?raw';
import fastForwardIcon from '../../icons/fast-forward.svg?raw';

// The time bar of the boards "Ciel, barre du temps" and "Ciel, barre du temps ouverte": the date and time of the sky
// shown with the speed of its clock, "Ce soir" (the end of twilight of the day shown), then slower or backward, play /
// pause, faster, "×1" and "Maintenant". A tap on the date opens the year to minute steppers inside the bar. They do
// what the desktop's time controls do: each one switches the map to the date mode, where the clock runs from the
// chosen moment. In the live mode the field shows the present time.
const time = useSkyTimeStore();
const { mode, simDate, paused, effectiveRate } = storeToRefs(time);

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The live sky is the one of this minute.
const LIVE_REFRESH_MS = 15000;
const now = ref(new Date());
const refresh = setInterval(() => (now.value = new Date()), LIVE_REFRESH_MS);
onBeforeUnmount(() => clearInterval(refresh));

const shown = computed(() => (mode.value === 'date' ? simDate.value : now.value));
// The speed is written after the moment, as on the desktop, once it is not the normal one.
const label = computed(() => {
  const moment = `${dateOf(shown.value)} ${clockOf(shown.value)}`;
  return effectiveRate.value === 1 ? moment : `${moment} · ×${effectiveRate.value}`;
});

const open = ref(false);

function toggleSteppers() {
  // Entering the date mode here is what the desktop does when its date field is pressed.
  if (mode.value !== 'date') time.setMode('date');
  open.value = !open.value;
}
</script>

<template>
  <div class="mob-timebar mob-timebar--rows">
    <div class="mob-timebar-row">
      <PhoneButton
        variant="field"
        :aria-expanded="String(open)"
        :aria-label="t('mobile.sky.dateField', { value: label })"
        @click="toggleSteppers"
      >
        <span class="mob-btn-label">{{ label }}</span>
        <span class="mob-btn-caret" aria-hidden="true"
          ><AppIcon :svg="open ? caretUpIcon : caretIcon"
        /></span>
      </PhoneButton>
      <PhoneButton @click="time.jumpToEvening()">{{ t('mobile.sky.tonight') }}</PhoneButton>
    </div>
    <SkyTimeSteppers v-if="open" :date="shown" />
    <div class="mob-timebar-row">
      <PhoneIconButton :label="t('mobile.sky.timeSlower')" @click="time.stepRateBackward()">
        <AppIcon :svg="rewindIcon" />
      </PhoneIconButton>
      <PhoneIconButton
        :label="paused ? t('skyTime.play') : t('skyTime.stop')"
        @click="time.togglePaused()"
      >
        <AppIcon :svg="paused ? playIcon : pauseIcon" />
      </PhoneIconButton>
      <PhoneIconButton :label="t('mobile.sky.timeFaster')" @click="time.stepRateForward()">
        <AppIcon :svg="fastForwardIcon" />
      </PhoneIconButton>
      <PhoneButton :aria-label="t('skyTime.setNormalSpeed')" @click="time.setRateNormal()"
        >×1</PhoneButton
      >
      <PhoneButton class="mob-timebar-end" @click="time.resetToNow()">{{
        t('mobile.sky.now')
      }}</PhoneButton>
    </div>
  </div>
</template>

<style>
/* Two rows (date and "Ce soir", then the clock's buttons), the steppers between them when the date is opened. */
.mob-timebar.mob-timebar--rows {
  flex-direction: column;
  align-items: stretch;
}
.mob-timebar-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.mob-timebar-row > .mob-timebar-end {
  margin-inline-start: auto;
}
/* Landscape (board "Ciel, barre du temps, paysage"): a card at the bottom right of the map. */
@media (orientation: landscape) {
  .mob-timebar.mob-timebar--rows {
    left: auto;
    right: var(--mobile-gutter);
    bottom: calc(var(--mobile-gutter) + var(--safe-bottom, 0px));
    inline-size: var(--mobile-timebar-width);
    box-sizing: border-box;
    padding: var(--space-4);
    border: 1px solid var(--border-panel);
    border-radius: var(--mobile-card-radius);
    box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-lg);
  }
}
</style>
