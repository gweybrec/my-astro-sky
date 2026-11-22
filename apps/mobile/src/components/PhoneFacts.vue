<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import PhoneFilterBadge from './PhoneFilterBadge.vue';

// Read-only figures (`.mob-facts`): label over value with no card, each as wide as its
// text, as many to a line as fit, as the desktop lists a target's or a photo's figures; a long value wraps inside the
// line. `tone` draws the value in a status colour, `rating` in the stars' colour, `mono` in the mono face, and
// `icon` (an SVG file's markup) follows the value, and `link` goes on a line of its own under it. A `line` fact takes a
// line of its own, its value cut with "…" when too long. In a map sheet, the sheet stops under the line of a `stop` fact.
// A fact with `exposures` (a photo's integration) takes a full line: one line per exposure, its time then its filter's
// badge (a row with only a filter shows just the badge).
defineProps<{
  facts: {
    label: string;
    value: string;
    tone?: 'success' | 'warn' | 'danger';
    rating?: boolean;
    mono?: boolean;
    icon?: string;
    stop?: boolean;
    line?: boolean;
    link?: { text: string; href: string };
    exposures?: { time: string; filter: string }[];
  }[];
}>();
</script>

<template>
  <div class="mob-facts">
    <div
      v-for="fact in facts"
      :key="fact.label"
      class="mob-fact"
      :class="{ 'mob-fact--line': fact.line, 'mob-fact--exposures': fact.exposures }"
      :title="fact.line ? fact.value : undefined"
      :data-sheet-stop="fact.stop ? '' : undefined"
    >
      <span class="mob-fact-label m-caption">{{ fact.label }}</span>
      <span v-if="fact.exposures" class="mob-fact-value mob-exposures m-body"
        ><span v-for="(exposure, i) in fact.exposures" :key="i" class="mob-exposures-row"
          ><span class="mob-exposures-time">{{ exposure.time }}</span
          ><PhoneFilterBadge v-if="exposure.filter" :filter="exposure.filter" /></span
      ></span>
      <span
        v-else
        class="mob-fact-value m-body"
        :class="[
          fact.tone ? `mob-status--${fact.tone}` : '',
          { 'mob-rating': fact.rating, 'mob-fact-value--lines': fact.link },
        ]"
        ><span v-if="fact.mono" class="m-mono">{{ fact.value }}</span
        ><template v-else>{{ fact.value }}</template
        ><AppIcon v-if="fact.icon" :svg="fact.icon" cls="mob-icon--sm" /><a
          v-if="fact.link"
          class="mob-link"
          :href="fact.link.href"
          >{{ fact.link.text }}</a
        ></span
      >
    </div>
  </div>
</template>
