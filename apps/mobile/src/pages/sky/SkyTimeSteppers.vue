<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore, type SimDateUnit } from '@myastrosky/app-state/stores/sky-time';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import plusIcon from '@icons/plus.svg?raw';
import minusIcon from '../../icons/minus.svg?raw';

// The opened time bar of the board "Ciel, barre du temps ouverte": year, month, day, hour and minute, each with a plus
// above and a minus below, like Stellarium's date window. A press steps the sky at once, holding keeps stepping.
const props = defineProps<{ date: Date }>();
const time = useSkyTimeStore();

const pad = (n: number) => String(n).padStart(2, '0');
const NAMES: Record<SimDateUnit, [up: string, down: string]> = {
  year: ['mobile.sky.stepUpYear', 'mobile.sky.stepDownYear'],
  month: ['mobile.sky.stepUpMonth', 'mobile.sky.stepDownMonth'],
  day: ['mobile.sky.stepUpDay', 'mobile.sky.stepDownDay'],
  hour: ['mobile.sky.stepUpHour', 'mobile.sky.stepDownHour'],
  minute: ['mobile.sky.stepUpMinute', 'mobile.sky.stepDownMinute'],
};

const columns = computed(() => {
  const d = props.date;
  const cols: { unit: SimDateUnit; value: string; after?: string }[] = [
    { unit: 'year', value: String(d.getFullYear()), after: '–' },
    { unit: 'month', value: pad(d.getMonth() + 1), after: '–' },
    { unit: 'day', value: pad(d.getDate()), after: '' },
    { unit: 'hour', value: pad(d.getHours()), after: ':' },
    { unit: 'minute', value: pad(d.getMinutes()) },
  ];
  return cols;
});
</script>

<template>
  <div class="mob-date-steppers" role="group" :aria-label="t('mobile.sky.stepGroup')">
    <template v-for="col in columns" :key="col.unit">
      <div class="mob-date-stepper">
        <PhoneIconButton
          repeat
          :label="t(NAMES[col.unit][0])"
          @click="time.stepSimDate(col.unit, 1)"
        >
          <AppIcon :svg="plusIcon" />
        </PhoneIconButton>
        <span class="m-title">{{ col.value }}</span>
        <PhoneIconButton
          repeat
          :label="t(NAMES[col.unit][1])"
          @click="time.stepSimDate(col.unit, -1)"
        >
          <AppIcon :svg="minusIcon" />
        </PhoneIconButton>
      </div>
      <span v-if="col.after" class="m-mono m-secondary" aria-hidden="true">{{ col.after }}</span>
      <span v-else-if="col.after === ''" class="mob-date-steppers-gap" aria-hidden="true" />
    </template>
  </div>
</template>

<style>
.mob-date-steppers {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
}
.mob-date-stepper {
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* Between the date and the time: a wider gap instead of a separator. */
.mob-date-steppers-gap {
  inline-size: var(--space-6);
}
</style>
