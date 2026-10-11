<script setup lang="ts">
import AppIcon from './AppIcon.vue';

// Read-only figures in cards (`.mob-facts`): label over value. A `wide` fact takes the whole row. `tone` draws the
// value in a status colour, `rating` in the stars' colour, and `icon` (an SVG file's markup) follows the value.
defineProps<{
  facts: {
    label: string;
    value: string;
    wide?: boolean;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    icon?: string;
  }[];
  columns?: 2 | 3;
}>();
</script>

<template>
  <div class="mob-facts" :class="{ 'mob-facts--2': columns !== 3 }">
    <div
      v-for="fact in facts"
      :key="fact.label"
      class="mob-fact"
      :class="{ 'mob-fact--wide': fact.wide }"
    >
      <span class="mob-fact-label m-caption">{{ fact.label }}</span>
      <span
        class="mob-fact-value m-body-strong"
        :class="[fact.tone ? `mob-status--${fact.tone}` : '', { 'mob-rating': fact.rating }]"
        >{{ fact.value }}<AppIcon v-if="fact.icon" :svg="fact.icon" cls="mob-icon--sm"
      /></span>
    </div>
  </div>
</template>
