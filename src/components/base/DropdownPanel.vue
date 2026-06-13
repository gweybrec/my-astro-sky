<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="panelRef"
      class="dropdown-panel"
      :style="posStyle"
      @click.stop
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  anchorEl: HTMLElement | null | undefined;
  alignRight?: boolean;
  minWidth?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const panelRef = ref<HTMLElement>();
const posStyle = ref<Record<string, string>>({});

function reposition() {
  const el = props.anchorEl;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 4;
  const goAbove = spaceBelow < 200 && rect.top > spaceBelow;
  const style: Record<string, string> = { position: 'fixed' };
  if (props.minWidth) style.minWidth = props.minWidth;
  if (props.alignRight) {
    style.right = `${window.innerWidth - rect.right}px`;
  } else {
    style.left = `${rect.left}px`;
  }
  if (goAbove) {
    style.bottom = `${window.innerHeight - rect.top + 4}px`;
    style.top = 'auto';
  } else {
    style.top = `${rect.bottom + 4}px`;
    style.bottom = 'auto';
  }
  posStyle.value = style;
}

function close() { emit('update:modelValue', false); }

watch(() => props.modelValue, (open) => {
  if (open) {
    nextTick(reposition);
    document.addEventListener('click', close);
  } else {
    document.removeEventListener('click', close);
  }
});

onBeforeUnmount(() => document.removeEventListener('click', close));
</script>
