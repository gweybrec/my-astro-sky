<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatClock24 } from '@myastrosky/core/targets/format';
import type { AltSample } from '@myastrosky/core/sky-geometry';
import { altChartLayout, type AltChartWindow } from '@myastrosky/core/targets/alt-chart';

// A target's altitude over the night (`.mob-alt-chart`; the desktop's trajectory chart,
// sharing its scale): 0 to 90° up with lines at 20, 40, 60 and 80°, the night across with every second hour under it,
// the target's curve, the Moon's dashed, the best time dotted, and the observation windows as bands in their colours.
// Drawn in a fixed box that scales with the width, as the board.
const props = defineProps<{
  curve: AltSample[];
  win: { start: Date; end: Date };
  bestTime: Date | null;
  maxAltDeg: number;
  moonCurve?: AltSample[] | null;
  windows?: AltChartWindow[];
}>();

const W = 380;
const H = 158;
const BOX = { left: 36, right: 372, top: 8, bottom: 136 };
const layout = computed(() =>
  altChartLayout({
    curve: props.curve,
    win: props.win,
    bestTime: props.bestTime,
    moonCurve: props.moonCurve,
    windows: props.windows,
    box: BOX,
  }),
);
// An hour too close to the ends would have its time cut by the edge of the chart.
const HOUR_ROOM = 18;
const hours = computed(() =>
  layout.value.hours.filter((h) => h.x >= BOX.left + HOUR_ROOM && h.x <= BOX.right - HOUR_ROOM),
);
const label = computed(() =>
  t('mobile.plans.chartAria', {
    alt: formatAlt(props.maxAltDeg),
    time: props.bestTime ? formatClock24(props.bestTime) : '—',
  }),
);
</script>

<template>
  <div class="mob-alt-chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label" focusable="false">
      <rect
        v-for="(w, n) in layout.windows"
        :key="`w${n}`"
        class="mob-alt-chart-window"
        :x="w.x"
        :y="BOX.top"
        :width="w.width"
        :height="BOX.bottom - BOX.top"
        rx="2"
        :fill="w.color"
      />
      <template v-for="tick in layout.ticks" :key="tick.deg">
        <line class="mob-alt-chart-grid" :x1="BOX.left" :x2="BOX.right" :y1="tick.y" :y2="tick.y" />
        <text
          v-if="tick.deg > 0"
          class="mob-alt-chart-tick m-caption"
          :x="BOX.left - 6"
          :y="tick.y + 4"
          text-anchor="end"
        >
          {{ formatAlt(tick.deg) }}
        </text>
      </template>
      <line
        v-if="layout.bestX !== null"
        class="mob-alt-chart-best"
        :x1="layout.bestX"
        :x2="layout.bestX"
        :y1="BOX.top"
        :y2="BOX.bottom"
      />
      <polyline v-if="layout.moon" class="mob-alt-chart-moon" :points="layout.moon" />
      <polyline class="mob-alt-chart-curve" :points="layout.curve" />
      <text
        v-for="hour in hours"
        :key="hour.time.getTime()"
        class="mob-alt-chart-tick m-caption"
        :x="hour.x"
        :y="H - 4"
        text-anchor="middle"
      >
        {{ formatClock24(hour.time) }}
      </text>
    </svg>
  </div>
</template>
