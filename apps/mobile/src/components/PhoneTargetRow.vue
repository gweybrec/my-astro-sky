<script setup lang="ts">
import { IonItem } from '@ionic/vue';
import PhoneBadge from './PhoneBadge.vue';

// A target of the Cibles list (`.mob-row--roomy`) on Ionic's item: the name, then the designation with the type and
// constellation badges, then the magnitude with the rating; at the right end the maximum altitude over the time of
// transit. A row is a tap target.
defineProps<{
  title: string;
  /** The primary catalogue designation (NGC7000), when it is not the name itself. */
  designation?: string;
  /** The type's name; the badge is not drawn without it. */
  typeLabel?: string;
  /** The constellation's three letters; the badge is not drawn without it. */
  constellation?: string;
  /** The third line's text before the stars ("Magnitude 7.2"). */
  magnitude?: string;
  /** The stars of the rating ("★★★★☆"). */
  rating?: string;
  /** The trailing figures; a row without them (a search result) has no trailing column. */
  altitude?: string;
  time?: string;
}>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <IonItem
    class="mob-row mob-row--roomy"
    lines="none"
    button
    :detail="false"
    @click="emit('click', $event)"
  >
    <div class="mob-row-line">
      <span class="mob-row-body">
        <span class="mob-row-title m-body">{{ title }}</span>
        <span class="mob-row-sub mob-meta m-secondary">
          <span v-if="designation">{{ designation }}</span>
          <PhoneBadge v-if="typeLabel" kind="type">{{ typeLabel }}</PhoneBadge>
          <PhoneBadge v-if="constellation" kind="const">{{ constellation }}</PhoneBadge>
        </span>
        <span v-if="magnitude || rating" class="mob-row-sub m-secondary"
          >{{ magnitude }}<template v-if="magnitude && rating"> · </template
          ><span v-if="rating" class="mob-rating">{{ rating }}</span></span
        >
      </span>
      <span v-if="altitude" class="mob-row-trail mob-row-trail--stack">
        <span class="mob-row-trail-main m-mono">{{ altitude }}</span>
        <span class="m-mono">{{ time }}</span>
      </span>
    </div>
  </IonItem>
</template>
