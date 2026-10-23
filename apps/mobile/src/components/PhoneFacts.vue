<script setup lang="ts">
import AppIcon from './AppIcon.vue';

// Read-only figures in cards (`.mob-facts`): label over value. A `wide` fact takes the whole row. `tone` draws the
// value in a status colour, `rating` in the stars' colour, `mono` in the mono face, and `icon` (an SVG file's markup)
// follows the value. `compact` lists them without cards, as many to a line as fit (design system revision 22: a
// photo's information).
defineProps<{
  facts: {
    label: string;
    value: string;
    wide?: boolean;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    mono?: boolean;
    icon?: string;
  }[];
  columns?: 2 | 3;
  compact?: boolean;
}>();
</script>

<template>
  <div
    class="mob-facts"
    :class="compact ? 'mob-facts--compact' : { 'mob-facts--2': columns !== 3 }"
  >
    <div
      v-for="fact in facts"
      :key="fact.label"
      class="mob-fact"
      :class="{ 'mob-fact--wide': fact.wide }"
    >
      <span class="mob-fact-label m-caption">{{ fact.label }}</span>
      <span
        class="mob-fact-value"
        :class="[
          compact ? 'm-body' : 'm-body-strong',
          fact.tone ? `mob-status--${fact.tone}` : '',
          { 'mob-rating': fact.rating },
        ]"
        ><span v-if="fact.mono" class="m-mono">{{ fact.value }}</span
        ><template v-else>{{ fact.value }}</template
        ><AppIcon v-if="fact.icon" :svg="fact.icon" cls="mob-icon--sm"
      /></span>
    </div>
  </div>
</template>
