<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import AppIcon from './AppIcon.vue';
import PhoneChip from './PhoneChip.vue';
import closeIcon from '@icons/close-x.svg?raw';

// Chips that a tap removes (`.mob-chip--remove`: the objects, labels and points of interest of a photo): the text and
// a small cross, the whole chip is the target. They wrap onto as many lines as they need; nothing is drawn without chips.
defineProps<{
  items: readonly {
    label: string;
    /** SVG markup of an icon before the text (the kind of a point of interest), in `color`. */
    icon?: string | null;
    color?: string;
  }[];
}>();
const emit = defineEmits<{ remove: [index: number] }>();
</script>

<template>
  <div v-if="items.length" class="mob-chip-row mob-chip-row--wrap">
    <PhoneChip
      v-for="(item, index) in items"
      :key="`${index}|${item.label}`"
      class="mob-chip--remove"
      :aria-label="t('mobile.photo.removeChip', { name: item.label })"
      @click="emit('remove', index)"
    >
      <span v-if="item.icon" class="mob-chip-kind" :style="{ color: item.color }"
        ><AppIcon :svg="item.icon" cls="mob-icon--sm"
      /></span>
      <span>{{ item.label }}</span>
      <AppIcon :svg="closeIcon" cls="mob-icon--sm" />
    </PhoneChip>
  </div>
</template>
