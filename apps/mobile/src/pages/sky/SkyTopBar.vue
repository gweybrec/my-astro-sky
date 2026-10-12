<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import PhoneSearch from '../../components/PhoneSearch.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import slidersIcon from '../../icons/sliders.svg?raw';
import calendarIcon from '@icons/calendar.svg?raw';

// The top row of the map ("Ciel"): the search field, the display settings and the date button. The date button is the
// desktop's: it switches the map between the live sky and the sky at a date (pressed in the date mode), and the
// toggles of the map appear while it is on. Switching to the date mode opens the date picker at once, as the desktop
// opens its date popover.
const emit = defineEmits<{ search: []; display: []; dateMode: [] }>();
const time = useSkyTimeStore();
const { mode } = storeToRefs(time);

function toggleDateMode() {
  const entering = mode.value !== 'date';
  time.toggleMode();
  if (entering) emit('dateMode');
}
</script>

<template>
  <div class="mob-map-top">
    <!-- Typing happens on the search page: this field only opens it. -->
    <PhoneSearch
      readonly
      :placeholder="t('search.placeholder')"
      :label="t('search.placeholder')"
      @click="emit('search')"
    />
    <PhoneIconButton float :label="t('display.section')" @click="emit('display')">
      <AppIcon :svg="slidersIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="mode === 'date' ? t('skyTime.liveModeButton') : t('skyTime.dateModeButton')"
      :pressed="mode === 'date'"
      @click="toggleDateMode"
    >
      <AppIcon :svg="calendarIcon" />
    </PhoneIconButton>
  </div>
</template>
