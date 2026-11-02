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
// telescope button) and the calendar button. The calendar button opens the layers sheet ("Ciel, calques de la carte"),
// whose first switch puts the map on the sky at a date; it is pressed while the map shows one.
const emit = defineEmits<{ search: []; display: []; frames: []; layers: [] }>();
const { mode } = storeToRefs(useSkyTimeStore());
</script>

<template>
  <div class="mob-map-top">
    <!-- Typing happens on the search page: this field only opens it. -->
    <PhoneSearch
      readonly
      :placeholder="t('mobile.sky.searchShort')"
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
      :label="t('mobile.sky.layers')"
      :pressed="mode === 'date'"
      @click="emit('layers')"
    >
      <AppIcon :svg="calendarIcon" />
    </PhoneIconButton>
  </div>
</template>
