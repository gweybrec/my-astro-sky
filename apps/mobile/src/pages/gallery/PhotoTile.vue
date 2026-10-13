<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTagRows } from '../../composables/useTagRows';
import AppIcon from '../../components/AppIcon.vue';
import PhoneBusy from '../../components/PhoneBusy.vue';
import imageIcon from '@icons/image.svg?raw';

/** A chip of a tile: the photo's equipment, a point of interest, a label or an object. */
export interface PhotoTag {
  kind: 'setup' | 'poi' | 'label' | 'dso';
  text: string;
  /** A point of interest's colour, and the icon of its kind when it has one (a coloured dot otherwise). */
  color?: string;
  icon?: string | null;
}

// A photo of the gallery (boards "Galerie" and "Galerie, résolutions en cours"): one card holding the picture and, in the
// same border, the photo's file name and its chips in the desktop's order, on two rows at most; the chips that do not
// fit are counted in a last one ("+3"). A photo that waits to be placed shows where it stands over its picture area.
const props = defineProps<{
  name: string;
  /** The picture's address; a waiting photo has none. */
  picture?: string;
  tags?: PhotoTag[];
  /** Where a waiting photo stands ("À placer", "Résolution"), and whether that is a running operation. */
  state?: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ click: [] }>();

// A picture that cannot be read leaves the picture area with its placeholder.
const broken = ref(false);
watch(
  () => props.picture,
  () => (broken.value = false),
);

const box = ref<HTMLElement | null>(null);
const { shown } = useTagRows(box, () => props.tags?.length ?? 0);
</script>

<template>
  <button
    type="button"
    class="mob-photo mob-photo-card"
    :aria-label="state ? `${name} : ${state}` : name"
    @click="emit('click')"
  >
    <span class="mob-photo-card-picture">
      <img
        v-if="picture && !broken"
        class="mob-photo-picture"
        :src="picture"
        alt=""
        loading="lazy"
        @error="broken = true"
      />
      <AppIcon v-else :svg="imageIcon" />
      <span
        v-if="state"
        class="mob-photo-state m-caption"
        :class="{ 'mob-photo-state--busy': busy }"
        ><PhoneBusy v-if="busy" :label="state" /><template v-else>{{ state }}</template></span
      >
    </span>
    <span class="mob-photo-card-caption">
      <span class="mob-photo-card-name m-secondary">{{ name }}</span>
      <span v-if="tags?.length" ref="box" class="mob-tags">
        <span
          v-for="(tag, n) in tags.slice(0, shown)"
          :key="n"
          class="mob-tag m-caption"
          :class="[`mob-tag--${tag.kind}`, { 'mob-tag--dot': tag.kind === 'poi' && !tag.icon }]"
          :style="tag.color ? { '--poi-color': tag.color } : undefined"
          ><AppIcon v-if="tag.icon" :svg="tag.icon" /><span class="mob-tag-text">{{
            tag.text
          }}</span></span
        >
        <span v-if="shown < tags.length" class="mob-tag mob-tag--more m-caption"
          ><span class="mob-tag-text">+{{ tags.length - shown }}</span></span
        >
      </span>
    </span>
  </button>
</template>
