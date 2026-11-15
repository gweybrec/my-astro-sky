<template>
  <div
    ref="rowEl"
    :class="selected ? 'bw-row--sel' : item.ticked ? 'bw-row--ticked' : 'bw-row'"
    :data-item-id="item.id"
  >
    <input
      type="checkbox"
      class="m-0 shrink-0 accent-[var(--accent-color)]"
      :checked="item.ticked"
      :aria-label="t('batch.selectPhoto', { name: displayName })"
      @change="emit('tick', ($event.target as HTMLInputElement).checked)"
    />
    <button
      type="button"
      class="flex-1 min-w-0 flex items-center gap-5 p-0 bg-transparent border-0 text-left cursor-pointer text-primary"
      :aria-current="selected ? 'true' : undefined"
      @click="emit('select')"
    >
      <span class="bw-thumb">
        <img
          v-if="item.thumbBlobUrl"
          :src="item.thumbBlobUrl"
          alt=""
          class="w-full h-full object-cover"
        />
        <span v-else v-html="imageSvg"></span>
      </span>
      <span class="flex-1 min-w-0 flex flex-col gap-2">
        <span class="truncate" :title="displayName">{{ displayName }}</span>
        <span class="flex flex-nowrap gap-2 overflow-hidden">
          <span :class="CHIP_CLASS[place.tone]">
            <span v-if="place.tone === 'run'" class="auto-solve-spinner !w-[10px] !h-[10px]"></span>
            {{ t(place.key, place.params) }}
          </span>
          <span :class="CHIP_CLASS[save.tone]">{{ t(save.key) }}</span>
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { BatchItem } from '../../batch-types';
import { t } from '../../i18n';
import { placementChip, saveChip, type BatchChip } from '../../batch-utils';
import { stripExtension } from '../../file-utils';
import { generateThumbnail } from '../../lazy-image';
import { isRawAstroFile } from '@myastrosky/core/photo-formats';
import imageSvg from '../../icons/image.svg?raw';

const props = defineProps<{ item: BatchItem; selected: boolean }>();
const emit = defineEmits<{ select: []; tick: [boolean] }>();

const displayName = computed(() => props.item.customName || stripExtension(props.item.file.name));
/** The chips' classes, spelt out: UnoCSS only makes the classes it finds written in full. */
const CHIP_CLASS: Record<BatchChip['tone'], string> = {
  todo: 'bw-chip--todo',
  run: 'bw-chip--run',
  fail: 'bw-chip--fail',
  ok: 'bw-chip--ok',
  warn: 'bw-chip--warn',
  saved: 'bw-chip--saved',
};
const place = computed(() => placementChip(props.item));
const save = computed(() => saveChip(props.item));

// ─── Thumbnail, made once the row comes near the view ────────────────────────
// The item keeps it (`thumbBlobUrl`), so the detail panel shows the same picture. A raw .fit/.tif/.xisf is nothing
// a browser can decode: the row waits for its converted PNG.
const rowEl = ref<HTMLElement | null>(null);
const seen = ref(false);
let observer: IntersectionObserver | null = null;
let madeFor: File | null = null;

const source = computed<File | null>(() => {
  const { file, status } = props.item;
  return status === 'converting' || isRawAstroFile(file.name) ? null : file;
});

watch(
  [seen, source],
  ([isSeen, file]) => {
    if (!isSeen || !file || file === madeFor) return;
    madeFor = file;
    void generateThumbnail(file, 240).then((url) => {
      if (madeFor !== file) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (props.item.thumbBlobUrl) URL.revokeObjectURL(props.item.thumbBlobUrl);
      props.item.thumbBlobUrl = url || null;
    });
  },
  { immediate: true },
);

onMounted(() => {
  if (!rowEl.value || typeof IntersectionObserver === 'undefined') {
    seen.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.value = true;
        observer?.disconnect();
      }
    },
    { rootMargin: '400px 0px' },
  );
  observer.observe(rowEl.value);
});

onUnmounted(() => observer?.disconnect());
</script>
