<script setup lang="ts">
// Read-only figures in cards (`.mob-facts`): label over value. A `wide` fact takes the whole row.
defineProps<{ facts: { label: string; value: string; wide?: boolean }[]; columns?: 2 | 3 }>();
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
      <span class="mob-fact-value m-body-strong">{{ fact.value }}</span>
    </div>
  </div>
</template>
