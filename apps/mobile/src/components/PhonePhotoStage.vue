<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { fittedSize, usePhotoZoom, type Size } from '../composables/usePhotoZoom';

/** A point of the photo, in its pixels from its top left. */
export interface PhotoPoint {
  x: number;
  y: number;
}

// A photo on the stage of a page that marks points on it (boards "Identifier les étoiles", "Identifier un astéroïde",
// "Ajouter un point d'intérêt"…): two fingers zoom, one finger moves a zoomed photo, and a tap on the photo is given
// as the photo's pixel under it (`tap`). The `default` slot draws the markers: `onScreen` gives where a pixel of the
// photo is in the stage, following the zoom. Without `size`, the photo's own size is read when it loads (`load`).
const props = defineProps<{
  src: string;
  alt?: string;
  /** The photo's size in pixels, when known before it loads. */
  size?: Size | null;
}>();
const emit = defineEmits<{ tap: [point: PhotoPoint]; load: [size: Size] }>();

const loaded = ref<Size | null>(null);
const photoSize = () => props.size ?? loaded.value;

function onLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  loaded.value = { width: img.naturalWidth, height: img.naturalHeight };
  emit('load', loaded.value);
}

// ── The photo's area and its zoom ────────────────────────────────────────────────────────────────

const area = ref<HTMLElement | null>(null);
const box = reactive({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!area.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => {
    box.width = entry.contentRect.width;
    box.height = entry.contentRect.height;
  });
  observer.observe(area.value);
});
onBeforeUnmount(() => observer?.disconnect());

const { zoom, transform, handlers } = usePhotoZoom(
  area,
  () => photoSize() ?? { width: 0, height: 0 },
  { onTap: tapAt },
);

/** Screen pixels per picture pixel. */
function pixelScale(): number {
  const size = photoSize();
  if (!size) return 0;
  return (fittedSize(size, box).width / size.width) * zoom.value.scale;
}

/** Where a point of the picture is in the photo's area (px from its top left). */
function onScreen(p: PhotoPoint): PhotoPoint {
  const k = pixelScale();
  const { width, height } = photoSize() ?? { width: 0, height: 0 };
  return {
    x: box.width / 2 + zoom.value.tx + (p.x - width / 2) * k,
    y: box.height / 2 + zoom.value.ty + (p.y - height / 2) * k,
  };
}

/** The point of the picture under a screen position (it may be off the picture). */
function onPicture(clientX: number, clientY: number): PhotoPoint | null {
  const rect = area.value?.getBoundingClientRect();
  const size = photoSize();
  const k = pixelScale();
  if (!rect || !size || k <= 0) return null;
  return {
    x: (clientX - rect.left - box.width / 2 - zoom.value.tx) / k + size.width / 2,
    y: (clientY - rect.top - box.height / 2 - zoom.value.ty) / k + size.height / 2,
  };
}

/** Whether a point is on the picture. */
function onThePicture(p: PhotoPoint): boolean {
  const size = photoSize();
  return !!size && p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
}

function tapAt(clientX: number, clientY: number) {
  const p = onPicture(clientX, clientY);
  if (p && onThePicture(p)) emit('tap', p);
}

defineExpose({ onScreen, onPicture, pixelScale, area, box, zoom });
</script>

<template>
  <main class="mob-stage mob-photo-stage" v-on="handlers">
    <div ref="area" class="mob-photo-area">
      <img
        v-if="src"
        class="mob-photo-view"
        :src="src"
        :alt="alt"
        :style="{ transform }"
        draggable="false"
        @load="onLoad"
      />
      <slot :on-screen="onScreen" />
    </div>
  </main>
</template>
