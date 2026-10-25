<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import type { QuarterTurns } from '@myastrosky/core/types';
import type { PhotoTag } from '../../photo-tags';
import AppIcon from '../../components/AppIcon.vue';
import PhoneBusy from '../../components/PhoneBusy.vue';
import PhoneTags from '../../components/PhoneTags.vue';
import imageIcon from '@icons/image.svg?raw';

// A photo of the gallery (boards "Galerie" and "Galerie, résolutions en cours"): one card holding the picture and, in the
// same border, the photo's file name and its chips in the desktop's order, on two rows at most; the chips that do not
// fit are counted in a last one ("+3"). A photo that waits to be placed shows where it stands over its picture area.
const props = defineProps<{
  name: string;
  /** The picture's address; a waiting photo has none. */
  picture?: string;
  /** Quarters to the right the picture is shown turned (the square card stays square). */
  turns?: QuarterTurns;
  tags?: PhotoTag[];
  /** Where a waiting photo stands ("À placer", "Résolution"), and whether that is a running operation. */
  state?: string;
  busy?: boolean;
  /** The tab is not shown: a picture still loading stops (it starts again once the tab is back). */
  paused?: boolean;
}>();
const emit = defineEmits<{ click: [] }>();

// A picture that cannot be read leaves the picture area with its placeholder.
const broken = ref(false);
const loaded = ref(false);
watch(
  () => props.picture,
  () => {
    broken.value = false;
    loaded.value = false;
  },
);
// Without its address the picture's download stops; one already loaded keeps it.
const src = computed(() => (props.paused && !loaded.value ? undefined : props.picture));
</script>

<template>
  <button
    type="button"
    class="mob-photo mob-photo-card"
    :aria-label="state ? t('mobile.format.labelValue', { label: name, value: state }) : name"
    @click="emit('click')"
  >
    <span class="mob-photo-card-picture">
      <img
        v-if="picture && !broken"
        class="mob-photo-picture"
        :src="src"
        :style="turns ? { transform: `rotate(${turns * 90}deg)` } : undefined"
        alt=""
        loading="lazy"
        @load="loaded = true"
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
      <PhoneTags v-if="tags?.length" :tags="tags" />
    </span>
  </button>
</template>
