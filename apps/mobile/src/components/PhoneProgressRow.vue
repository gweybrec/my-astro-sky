<script setup lang="ts">
// A read-only completion row (`.mob-progress-row`): the label in full with the count on its baseline, then a
// full-width bar in an outlined track, so the remaining gap and 100 % read at a glance
// (Réglages, statistiques: one row per DSO catalog family).
defineProps<{
  title: string;
  /** The "N / M" text beside the label. */
  value: string;
  /** 0-100. */
  percent: number;
}>();
</script>

<template>
  <div class="mob-progress-row">
    <div class="mob-progress-head">
      <span class="mob-progress-label m-body">{{ title }}</span>
      <span class="mob-progress-value m-mono">{{ value }}</span>
    </div>
    <div class="mob-progress-track">
      <div class="mob-progress-fill" :style="{ width: percent + '%' }" />
    </div>
  </div>
</template>
