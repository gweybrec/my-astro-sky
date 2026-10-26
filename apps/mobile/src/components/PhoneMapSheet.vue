<script setup lang="ts">
import { computed, inject, nextTick, provide, ref, useId, watch } from 'vue';
import { IonModal } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSheetStops } from '../composables/useSheetStops';
import { MAP_SHEET_HOST, SHEET_HOLD } from './map-sheet';
import PhoneSheetGrab from './PhoneSheetGrab.vue';

// A sheet of the map (`.mob-map-sheet`: the object, photo and frame sheets): Ionic's sheet modal over the bottom of the
// map, with no scrim, so the map stays in view and can be touched. It follows the finger and closes from where it is
// let go (Ionic's sheet gesture). Its room (`.mob-map-sheet-room`, in the page) is the map under its search row. Its
// content may mark where it stops (`data-sheet-stop`: under a line, or above a row): it opens at the first mark and
// stops at each, then shows everything the room holds. Without marks, in portrait it opens at most a third of the room
// tall and a drag up takes it to two thirds. Its content scrolls under the handle and the title. It closes by a drag down, a tap on its handle (`close`), and the page closes it for a tap on
// an empty spot of the map and for the back button. It must sit in a PhoneMapSheetHost (outside one it is not drawn: an
// error in development and in the tests), which slides it out when the page removes it. Its rows have no dividers (the
// boards of the map's sheets).
defineProps<{
  title: string;
  /** Only the handle and the title are shown (a frame being dragged: board "Ciel, déplacer le cadre"). */
  collapsed?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const pageShown = inject(MAP_SHEET_HOST, null);
if (!pageShown) {
  throw new Error(
    'PhoneMapSheet is drawn outside a PhoneMapSheetHost: it would neither slide in nor out.',
  );
}
const titleId = useId();
const room = ref<HTMLElement>();
const sheet = ref<HTMLElement>();
/** The room's box on screen: Ionic moves the modal to the app's root, where it is placed over the room. */
const place = ref<DOMRect | null>(null);
/**
 * How far the room ends above the bottom of the screen (the tab bar), in px. Ionic measures a sheet from the bottom of
 * the screen: the modal reaches it, with a strip that height under the sheet, clipped and passing touches through.
 */
const under = computed(() =>
  place.value ? Math.max(0, window.innerHeight - place.value.bottom) : 0,
);
// Where its content marks a stop (`data-sheet-stop`), the sheet stops there; otherwise at a third in portrait.
const { stops, measure } = useSheetStops(
  () => room.value,
  () => sheet.value,
  () => true,
  () => under.value,
  true,
);
// Content still loading what it shows (`SHEET_HOLD`) holds the measure back, at most `HOLD_MS`: a mark measured
// before its line is there would stop the sheet in the middle of it.
const holds: Promise<unknown>[] = [];
provide(SHEET_HOLD, (loading) => holds.push(loading));
const HOLD_MS = 500;
const modalId = `mob-map-sheet-${useId()}`;
const ready = ref(false);
/** How long a page coming back may stay without a size before the sheet opens anyway, in ms. */
const WAIT_SHOWN_MS = 3000;
function settle(since = performance.now()) {
  if (!room.value || !pageShown?.value) return;
  // A page coming back (from a page pushed over the tabs) may not be laid out yet.
  if (room.value.closest('.ion-page-hidden') && performance.now() - since < WAIT_SHOWN_MS) {
    requestAnimationFrame(() => settle(since));
    return;
  }
  const loaded = Promise.race([
    Promise.allSettled(holds),
    new Promise((resolve) => setTimeout(resolve, HOLD_MS)),
  ]);
  // Laid out once what was loading is drawn.
  void loaded.then(() => nextTick(() => requestAnimationFrame(measureNow)));
}
function measureNow() {
  if (!room.value || !pageShown?.value) return;
  place.value = room.value.getBoundingClientRect();
  // How tall the sheet opens, in px: the page frames what it shows beside it, as soon as the sheet is measured.
  room.value.dataset.cover = String(measure().opens);
  ready.value = true;
}
// Its content is mounted while it is closed, and measured each time its page comes on screen (it has no size while
// the page is hidden): the sheet then opens at the stops found.
watch(
  pageShown,
  (shown) => {
    if (shown) void nextTick(() => settle());
    else ready.value = false;
  },
  { immediate: true },
);
const open = computed(() => pageShown.value && ready.value);
const modalStyle = computed(() => {
  const box = place.value;
  if (!box) return undefined;
  return {
    '--map-sheet-left': `${box.left}px`,
    '--map-sheet-width': `${box.width}px`,
    '--map-sheet-under': `${under.value}px`,
    ...(stops.value?.height ? { '--height': `${stops.value.height}px` } : {}),
  };
});
const sheetStyle = computed(() =>
  stops.value?.max ? { '--sheet-stop-max': `${stops.value.max}px` } : undefined,
);
function dismissed(event: CustomEvent<{ role?: string }>) {
  if (event.detail.role === 'gesture') emit('close');
}
</script>

<template>
  <div ref="room" class="mob-map-sheet-room" :data-modal="modalId">
    <IonModal
      :id="modalId"
      class="mob-sheet-modal mob-sheet-modal--map"
      :is-open="open"
      :breakpoints="stops?.breakpoints ?? [0, 1]"
      :initial-breakpoint="stops?.initial ?? 1"
      :handle="false"
      :show-backdrop="false"
      :backdrop-dismiss="false"
      :backdrop-breakpoint="1"
      :focus-trap="false"
      :expand-to-scroll="false"
      keep-contents-mounted
      :style="modalStyle"
      @did-dismiss="dismissed"
    >
      <section
        ref="sheet"
        class="mob-sheet mob-map-sheet"
        :class="{ 'mob-sheet--fixed': stops?.height }"
        :style="sheetStyle"
        :aria-labelledby="titleId"
      >
        <PhoneSheetGrab :label="t('mobile.sky.closeSheet')" @click="emit('close')" />
        <div class="mob-sheet-header">
          <h2 :id="titleId" class="mob-sheet-title m-title">{{ title }}</h2>
          <!-- The line under the title (`.mob-meta`). -->
          <slot name="meta" />
        </div>
        <div v-show="!collapsed" class="mob-sheet-body mob-scroll ion-content-scroll-host">
          <slot />
        </div>
      </section>
      <div class="mob-map-sheet-under" />
    </IonModal>
  </div>
</template>
