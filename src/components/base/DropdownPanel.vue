<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="panelRef"
      class="dropdown-panel"
      @click.stop
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { attachAnchoredPanel } from '../../popup-utils';

const props = defineProps<{
  modelValue: boolean;
  anchorEl: HTMLElement | null | undefined;
  alignRight?: boolean;
  minWidth?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const panelRef = ref<HTMLElement>();
let cleanup: (() => void) | null = null;

function close() { emit('update:modelValue', false); }

function teardown() {
  cleanup?.();
  cleanup = null;
  document.removeEventListener('click', close);
}

watch(() => props.modelValue, (open) => {
  if (open) {
    nextTick(() => {
      if (!panelRef.value || !props.anchorEl) return;
      cleanup = attachAnchoredPanel(panelRef.value, props.anchorEl, {
        alignRight: props.alignRight,
        minWidth: props.minWidth,
        onAnchorOutOfView: close,
      });
    });
    document.addEventListener('click', close);
  } else {
    teardown();
  }
});

onBeforeUnmount(teardown);
</script>
