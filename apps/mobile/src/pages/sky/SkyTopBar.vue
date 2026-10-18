<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import PhoneSearch from '../../components/PhoneSearch.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import slidersIcon from '../../icons/sliders.svg?raw';
import calendarIcon from '@icons/calendar.svg?raw';
import telescopeIcon from '@icons/telescope.svg?raw';

// The top row of the map ("Ciel"): the search field, the display settings, the frames ("Contours de champ", the desktop's
// telescope button) and the date button. The date button is the
// desktop's: it switches the map between the live sky and the sky at a date (pressed in the date mode), and the
// time bar and the toggles of the map appear while it is on; switching to the date mode picks nothing by itself.
const emit = defineEmits<{ search: []; display: []; frames: [] }>();
const time = useSkyTimeStore();
const { mode } = storeToRefs(time);
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
    <PhoneIconButton float :label="t('fovOverlay.btnTitle')" @click="emit('frames')">
      <AppIcon :svg="telescopeIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :label="mode === 'date' ? t('skyTime.liveModeButton') : t('skyTime.dateModeButton')"
      :pressed="mode === 'date'"
      @click="time.toggleMode()"
    >
      <AppIcon :svg="calendarIcon" />
    </PhoneIconButton>
  </div>
</template>
