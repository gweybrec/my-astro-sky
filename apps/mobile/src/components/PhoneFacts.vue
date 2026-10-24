<script setup lang="ts">
import AppIcon from './AppIcon.vue';

// Read-only figures (`.mob-facts`, design system revision 24): label over value with no card, each as wide as its
// text, as many to a line as fit, as the desktop lists a target's or a photo's figures; a long value wraps inside the
// line. `tone` draws the value in a status colour, `rating` in the stars' colour, `mono` in the mono face, and
// `icon` (an SVG file's markup) follows the value.
defineProps<{
  facts: {
    label: string;
    value: string;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    mono?: boolean;
    icon?: string;
  }[];
}>();
</script>

<template>
  <div class="mob-facts">
    <div v-for="fact in facts" :key="fact.label" class="mob-fact">
      <span class="mob-fact-label m-caption">{{ fact.label }}</span>
      <span
        class="mob-fact-value m-body"
        :class="[fact.tone ? `mob-status--${fact.tone}` : '', { 'mob-rating': fact.rating }]"
        ><span v-if="fact.mono" class="m-mono">{{ fact.value }}</span
        ><template v-else>{{ fact.value }}</template
        ><AppIcon v-if="fact.icon" :svg="fact.icon" cls="mob-icon--sm"
      /></span>
    </div>
  </div>
</template>
