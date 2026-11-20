<script setup lang="ts">
import { IonItem } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneBadge from './PhoneBadge.vue';
import PhoneIconButton from './PhoneIconButton.vue';
import AppIcon from './AppIcon.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';

// An object of a catalogue (board "Réglages, statistiques, un catalogue"): its designation, the green "Photographié"
// badge once photographed and the rating's stars at the right end; its name in the language under it; then its type
// and magnitude. The row itself is not a tap target: its one action is the map button at its end.
defineProps<{
  designation: string;
  /** Its name in the language, when it has one besides its designation. */
  name?: string;
  photographed: boolean;
  typeLabel: string;
  /** The magnitude line ("Mag 7.4"); none without a magnitude. */
  magnitude?: string;
  /** The stars of the rating ("★★★★☆"). */
  rating?: string;
  /** The rating's spoken form ("Intérêt photo : 4 sur 5"). */
  ratingLabel?: string;
}>();
const emit = defineEmits<{ map: [] }>();
</script>

<template>
  <IonItem class="mob-row mob-row--roomy" lines="none" :detail="false">
    <div class="mob-row-line">
      <span class="mob-row-body">
        <span class="mob-target-head phone-object-head">
          <span class="mob-row-title m-body">{{ designation }}</span>
          <PhoneBadge v-if="photographed" kind="success">{{
            t('stats.catalog.photographed')
          }}</PhoneBadge>
          <span v-if="rating" class="mob-rating m-secondary" :aria-label="ratingLabel">{{
            rating
          }}</span>
        </span>
        <span v-if="name" class="mob-row-sub m-secondary">{{ name }}</span>
        <span class="mob-row-sub mob-meta m-secondary">
          <PhoneBadge kind="type">{{ typeLabel }}</PhoneBadge>
          <span v-if="magnitude">{{ magnitude }}</span>
        </span>
      </span>
      <span class="mob-row-trail">
        <PhoneIconButton
          :label="t('stats.catalog.showOnMap', { name: designation })"
          @click="emit('map')"
        >
          <AppIcon :svg="mapPinIcon" />
        </PhoneIconButton>
      </span>
    </div>
  </IonItem>
</template>
