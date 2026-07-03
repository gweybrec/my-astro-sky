<template>
  <div class="sidebar-section" :class="{ collapsed: !isOpen }">
    <div class="sidebar-section-header" @click="toggle">
      <span>{{ title }}</span>
      <span class="sidebar-section-chevron">▾</span>
    </div>
    <div class="sidebar-section-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    defaultOpen?: boolean;
    /** Optional controlled mode: bind with v-model:open. null = uncontrolled. */
    open?: boolean | null;
  }>(),
  { defaultOpen: true, open: null },
);

const emit = defineEmits<{ 'update:open': [v: boolean] }>();

const internalOpen = ref(props.open ?? props.defaultOpen);

watch(
  () => props.open,
  (v) => {
    if (v != null) internalOpen.value = v;
  },
);

const isOpen = computed(() => (props.open != null ? props.open : internalOpen.value));

function toggle() {
  const next = !isOpen.value;
  internalOpen.value = next;
  emit('update:open', next);
}
</script>
