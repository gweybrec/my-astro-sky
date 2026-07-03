<template>
  <Teleport to="body">
    <div class="modal-backdrop">
      <div class="modal" :class="[sizeClass, modalClass]">
        <div class="modal-header">
          <slot name="title">
            <h2>{{ title }}</h2>
          </slot>
          <button class="modal-close" @click="close">✕</button>
        </div>
        <div class="modal-body" :class="bodyClass">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    size?: 'default' | 'wide' | 'flex';
    bodyClass?: string;
    modalClass?: string;
  }>(),
  {
    title: '',
    size: 'default',
    bodyClass: undefined,
    modalClass: undefined,
  },
);

const emit = defineEmits<{ close: [] }>();

const sizeClass = computed(() => ({
  'settings-modal': props.size === 'wide',
  'modal-flex': props.size === 'flex',
}));

function close() {
  emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>
