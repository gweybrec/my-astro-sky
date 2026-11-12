<script setup lang="ts">
import { IonItem } from '@ionic/vue';
import PhoneBadge from './PhoneBadge.vue';
import PhoneFacts from './PhoneFacts.vue';

// A result of the Cibles list or of the map's search (`.mob-row--roomy`) on Ionic's item: the name with the rating's
// stars at its right end, then the designation with the type and constellation badges, then the figures as compact
// facts (a deep-sky object) or the magnitude line (a star). A row is a tap target.
defineProps<{
  title: string;
  /** The main catalogue designation when it is not the name itself, and the one searched when it differs (M31 · NGC224). */
  designation?: string;
  /** The type's name; the badge is not drawn without it. */
  typeLabel?: string;
  /** The constellation's three letters; the badge is not drawn without it. */
  constellation?: string;
  /** The stars of the rating ("★★★★☆"), at the right end of the name. */
  rating?: string;
  /** A star's third line ("Magnitude 1.2"). */
  magnitude?: string;
  /** A deep-sky object's figures, label over value. */
  facts?: { label: string; value: string }[];
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
        <span class="mob-target-head">
          <span class="mob-row-title m-body">{{ title }}</span>
          <span v-if="rating" class="mob-rating m-secondary">{{ rating }}</span>
        </span>
        <span class="mob-row-sub mob-meta m-secondary">
          <span v-if="designation">{{ designation }}</span>
          <PhoneBadge v-if="typeLabel" kind="type">{{ typeLabel }}</PhoneBadge>
          <PhoneBadge v-if="constellation" kind="const">{{ constellation }}</PhoneBadge>
        </span>
        <span v-if="magnitude" class="mob-row-sub m-secondary">{{ magnitude }}</span>
        <PhoneFacts v-if="facts?.length" class="mob-target-facts" :facts="facts" />
      </span>
    </div>
  </IonItem>
</template>
