<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { pagesByLine } from '../chip-pages';
import PhoneChip from './PhoneChip.vue';

// A photo's objects as compact chips (boards "Ciel, photo sélectionnée" and "Photo, informations"), in the order given,
// at most two lines of chips to a page in portrait and one in landscape (a sheet in landscape has no room for two), the
// pages swiped, with dots when there is more than one. The chips are laid out once in a hidden row as wide as a page,
// and the pages are cut where they wrap (again when the width changes, as when the phone turns). `still` chips only
// show the objects (no tap); otherwise a tap emits the object.
const props = defineProps<{ ids: readonly string[]; label: string; still?: boolean }>();
const emit = defineEmits<{ pick: [id: string] }>();

const measure = ref<HTMLElement | null>(null);
const pages = ref<string[][]>(props.ids.length ? [[...props.ids]] : []);
function cutPages() {
  const row = measure.value;
  if (!row || !props.ids.length) {
    pages.value = props.ids.length ? [[...props.ids]] : [];
    return;
  }
  const tops = [...row.children].map((chip) => (chip as HTMLElement).offsetTop);
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? false;
  pages.value = pagesByLine([...props.ids], tops, landscape ? 1 : 2);
}
let resize: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(cutPages);
  // The chips' width changes once the fonts are in.
  void document.fonts?.ready.then(cutPages);
  if (measure.value && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(cutPages);
    resize.observe(measure.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
watch(
  () => props.ids,
  () => void nextTick(cutPages),
);
const page = ref(0);
function onScroll(event: Event) {
  const track = event.currentTarget as HTMLElement;
  page.value = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
}
const pageLabel = (n: number) => t('mobile.sky.pageOf', { n, total: pages.value.length });
</script>

<template>
  <!-- The chips laid out as on a page, to find where they wrap; not shown, not reachable. -->
  <div
    v-if="ids.length"
    ref="measure"
    class="mob-chip-row mob-chip-row--wrap mob-pager-measure"
    aria-hidden="true"
    inert
  >
    <PhoneChip v-for="id in ids" :key="id" compact still>{{ id }}</PhoneChip>
  </div>
  <div
    v-if="pages.length"
    class="mob-pager"
    role="group"
    aria-roledescription="carousel"
    :aria-label="label"
  >
    <div class="mob-pager-track" @scroll.passive="onScroll">
      <div
        v-for="(pageIds, n) in pages"
        :key="n"
        class="mob-pager-page mob-chip-row mob-chip-row--wrap"
        role="group"
        :aria-label="pageLabel(n + 1)"
      >
        <PhoneChip
          v-for="id in pageIds"
          :key="id"
          compact
          :still="still"
          @click="emit('pick', id)"
          >{{ id }}</PhoneChip
        >
      </div>
    </div>
    <div
      v-if="pages.length > 1"
      class="mob-pager-dots"
      role="img"
      :aria-label="pageLabel(page + 1)"
    >
      <span
        v-for="(_, n) in pages"
        :key="n"
        class="mob-pager-dot"
        :class="{ 'mob-pager-dot--on': n === page }"
      />
    </div>
  </div>
</template>
