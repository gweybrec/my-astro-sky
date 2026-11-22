<script setup lang="ts">
import { computed } from 'vue';
import { IonBadge } from '@ionic/vue';
import { filterBadgeColors } from '@myastrosky/core/color-utils';
import { catalogFilterColor } from '@myastrosky/core/gear-catalog';
import { filterCssKey } from '@myastrosky/core/filter-keys';

// A filter as its coloured badge (`.mob-badge--filter`), as the desktop draws an exposure row's filter: a filter of the
// catalogue in its own colour, a generic band (L, R, G, B, Ha, OIII, SII, RGB, dual band) in the design system's colours
// for that band, any other name in the "custom" colours. The colours reach the badge as three variables.
const props = defineProps<{ filter: string }>();

const colours = computed(() => {
  const hex = catalogFilterColor(props.filter);
  if (hex) {
    const { bg, text, border } = filterBadgeColors(hex);
    return {
      '--filter-badge-bg': bg,
      '--filter-badge-text': text,
      '--filter-badge-border': border,
    };
  }
  const key = filterCssKey(props.filter);
  return {
    '--filter-badge-bg': `var(--filter-${key})`,
    '--filter-badge-text': `var(--filter-${key}-text)`,
    '--filter-badge-border': `var(--filter-${key}-border)`,
  };
});
</script>

<template>
  <IonBadge class="mob-badge mob-badge--filter m-caption" :style="colours">{{ filter }}</IonBadge>
</template>
