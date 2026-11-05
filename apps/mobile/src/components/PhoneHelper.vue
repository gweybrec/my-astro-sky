<script setup lang="ts">
defineProps<{
  /** The caption size: a hint that would otherwise wrap (the "Touchez la photo…" of the identifications). */
  small?: boolean;
}>();
</script>

<template>
  <!-- A line of state under a control (`.mob-helper`); a class such as `mob-status--warn` gives it the warning colour. -->
  <p class="mob-helper" :class="small ? 'm-caption' : 'm-secondary'"><slot /></p>
</template>
