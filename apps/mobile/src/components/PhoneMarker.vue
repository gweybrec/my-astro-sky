<script setup lang="ts">
// A point marked on a photo (`.mob-marker`): a ring with a dot holding the point's number or letter, centred on the
// point by the anchor the page places. With `button` it is a target the page drags (a point of a star identification,
// its pointer handlers fall through); otherwise it is only drawn. `tint` takes the ring's colour from `--poi-color`.
defineProps<{
  label: string;
  /** The number or letter in the dot. */
  text?: string;
  active?: boolean;
  tint?: boolean;
  button?: boolean;
}>();
</script>

<template>
  <button
    v-if="button"
    type="button"
    class="mob-marker"
    :class="{ 'mob-marker--active': active, 'mob-marker--tint': tint }"
    :aria-label="label"
  >
    <span class="mob-marker-dot m-secondary">{{ text }}</span>
  </button>
  <span
    v-else
    class="mob-marker"
    :class="{ 'mob-marker--active': active, 'mob-marker--tint': tint }"
    role="img"
    :aria-label="label"
    ><span class="mob-marker-dot m-secondary">{{ text }}</span></span
  >
</template>
