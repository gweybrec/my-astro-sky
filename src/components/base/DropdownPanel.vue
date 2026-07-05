<template>
  <Teleport to="body">
    <div v-if="modelValue" ref="panelRef" class="dropdown-panel" @click.stop>
      <slot />
    </div>
  </Teleport>
</template>

<script lang="ts">
// Module-level registry so only one DropdownPanel is open at a time across the
// whole app. Opening a panel closes whichever other panel was open. This lives
// here (not in each caller) because the anchor buttons use `@click.stop`, which
// prevents the document-click listener below from catching a cross-dropdown
// click — so panels can't rely on outside-click to close each other.
let closeActivePanel: (() => void) | null = null;
</script>

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

function close() {
  emit('update:modelValue', false);
}

function teardown() {
  cleanup?.();
  cleanup = null;
  document.removeEventListener('click', close);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      // Close any other open dropdown before showing this one.
      if (closeActivePanel && closeActivePanel !== close) closeActivePanel();
      closeActivePanel = close;
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
      if (closeActivePanel === close) closeActivePanel = null;
      teardown();
    }
  },
  // `immediate: true` matters when a caller mounts this component with modelValue
  // already `true` in the same tick the anchor button itself first renders (e.g.
  // toggling into a mode that both shows the anchor and opens its panel at once) —
  // a plain `watch()` only fires on a *change*, so that initial `true` would never
  // attach the positioning/outside-click listeners, leaving an unpositioned panel
  // that only a second toggle (a real change from false) would actually open.
  { immediate: true },
);

onBeforeUnmount(() => {
  if (closeActivePanel === close) closeActivePanel = null;
  teardown();
});
</script>
