<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { affineToCSS } from '@myastrosky/core/affine';
import { findDSOsInImage } from '@myastrosky/core/catalog/dso-registry';
import {
  buildSyntheticCorrespondences,
  computeManualMatrix,
  computeManualProjMatrix,
  formatZoomPercent,
} from '@myastrosky/core/photo-placement';
import { fromCanvas, project, toCanvas, unproject } from '@myastrosky/core/projection';
import { normalizeRotationDeg } from '@myastrosky/core/sky-map-types';
import type { ManualPlacement, Photo, ViewState } from '@myastrosky/core/types';
import { uploadPhoto } from '@myastrosky/app-state/api';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { catalogsReady } from '../../catalogs';
import { useErrorToast } from '../../composables/useErrorToast';
import { useSheetDrag, useSheetExpand } from '../../composables/useSheetDrag';
import { pendingPhotoFile, removePendingPhoto } from '../../pending-photos';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneSearch from '../../components/PhoneSearch.vue';
import PhoneSliderRow from '../../components/PhoneSliderRow.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';

// The board "Placer la photo", as the desktop's manual placement does it (`openManualPlacement`): the photo, half seen
// through, lies over the map where it was being looked at. One finger on the photo moves it, two fingers make it larger
// or smaller and turn it; the map itself still moves under a finger put beside the photo. Valider stores the photo with
// that placement and three points of the sky taken from it, and the objects that fall in it.
const props = defineProps<{
  map: SkyMap;
  /** The map's box: the photo is drawn in it, over the canvas. */
  mapEl: HTMLElement;
  pendingId: string;
  /** Calls back on each change of the map's view; returns the function that stops it. */
  onView: (listener: () => void) => () => void;
}>();
const emit = defineEmits<{ cancel: []; placed: [photo: Photo]; search: [] }>();
const { showError } = useErrorToast();

/** The photo's first size: its longer side over this part of the map's shorter side. */
const FIRST_FIT = 0.6;
/** The size slider, in powers of two of the first size (as the desktop's "Zoom photo"). */
const ZOOM_MIN = -4;
const ZOOM_MAX = 3;

const file = shallowRef<File | null>(null);
const url = ref('');
const size = ref<{ width: number; height: number } | null>(null);
const placement = reactive<ManualPlacement>({
  centerRa: 0,
  centerDec: 0,
  rotationDeg: 0,
  projPerPx: 1,
  mirrorX: false,
  mirrorY: false,
});
let firstProjPerPx = 1;
const opacity = ref(0.85);

// ── The panel folded down (portrait) ─────────────────────────────────────────────────────────────
// As a bottom sheet, the panel folds down to its handle and its buttons, by a tap on the handle or a drag down from it,
// and opens again the same way: the map then has the room to place the photo by hand. Open, a drag up takes it from a
// third of the frame to two thirds, and a drag down back to a third. In landscape the panel is a column beside the map
// and does not fold.
const folded = ref(false);
const { expanded, grow } = useSheetExpand();
const landscapeQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: landscape)') : null;
const landscape = ref(landscapeQuery?.matches ?? false);
const onTurn = () => (landscape.value = landscapeQuery?.matches ?? false);
landscapeQuery?.addEventListener('change', onTurn);
const settingsShown = computed(() => landscape.value || !folded.value);
const grab = useSheetDrag(
  () => {
    if (expanded.value) expanded.value = false;
    else folded.value = true;
  },
  () => {
    if (folded.value) folded.value = false;
    else grow();
  },
);
/** A drag on the handle ends with a click on it, which must not fold it back. */
function toggleFold() {
  if (grab.wasDragged()) return;
  folded.value = !folded.value;
  expanded.value = false;
}
const view = shallowRef<ViewState>(props.map.getView());
const saving = ref(false);

let stopView: (() => void) | null = null;

// ── The map moved by the app (a search): the photo goes along ────────────────────────────────────────
// While the map moves to a searched object, the photo stays at the centre of the screen and keeps its size there, so
// that the zoom of the search does not blow it up: only a gesture changes its size on screen. It follows until the map
// has stopped for a moment, or until a finger takes it.
const FOLLOW_SETTLE_MS = 300;
let following: { onScreen: number } | null = null;
let followTimer: ReturnType<typeof setTimeout> | undefined;

function onViewChange() {
  const v = props.map.getView();
  if (following) {
    const ratio = following.onScreen / v.scale / placement.projPerPx;
    const centre = props.map.viewCenterSky();
    placement.centerRa = centre.ra;
    placement.centerDec = centre.dec;
    placement.projPerPx *= ratio;
    // "Zoom photo" reads the size on screen: the same before and after.
    firstProjPerPx *= ratio;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => (following = null), FOLLOW_SETTLE_MS);
  }
  view.value = v;
}

/** Runs a move of the map that the photo follows (the screen goes to a searched object). */
function follow(move: () => void) {
  following = { onScreen: placement.projPerPx * props.map.getView().scale };
  move();
  onViewChange();
}
defineExpose({ follow });
onMounted(async () => {
  stopView = props.onView(onViewChange);
  file.value = await pendingPhotoFile(props.pendingId);
  if (!file.value) {
    emit('cancel');
    return;
  }
  url.value = URL.createObjectURL(file.value);
});
onBeforeUnmount(() => {
  landscapeQuery?.removeEventListener('change', onTurn);
  stopView?.();
  clearTimeout(followTimer);
  if (url.value) URL.revokeObjectURL(url.value);
});

/** The picture is read: the photo starts at the centre of the map, its longer side over most of the map. */
function onLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  size.value = { width: img.naturalWidth, height: img.naturalHeight };
  const v = props.map.getView();
  const centre = props.map.viewCenterSky();
  placement.centerRa = centre.ra;
  placement.centerDec = centre.dec;
  firstProjPerPx =
    (FIRST_FIT * Math.min(v.width, v.height)) /
    Math.max(img.naturalWidth, img.naturalHeight) /
    v.scale;
  placement.projPerPx = firstProjPerPx;
  view.value = v;
}

const transform = computed(() =>
  size.value
    ? affineToCSS(computeManualMatrix(placement, view.value, size.value.width, size.value.height))
    : 'none',
);

const rotation = computed({
  get: () => Math.round(placement.rotationDeg),
  set: (deg: number) => (placement.rotationDeg = deg),
});
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const zoom = computed({
  get: () => Math.log2(placement.projPerPx / firstProjPerPx),
  set: (z: number) => (placement.projPerPx = firstProjPerPx * 2 ** clampZoom(z)),
});
const mirror = computed({
  get: () => placement.mirrorX,
  set: (on: boolean) => (placement.mirrorX = on),
});

// ── Touches on the photo ─────────────────────────────────────────────────────────────────────────

interface Pos {
  x: number;
  y: number;
}
const pointers = new Map<number, Pos>();
let start: { points: Pos[]; centre: Pos; rotationDeg: number; projPerPx: number } | null = null;

const posOf = (e: PointerEvent): Pos => {
  const box = props.mapEl.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
};
const centreOnMap = (): Pos => {
  const p = project(placement.centerRa, placement.centerDec);
  return toCanvas(p.x, p.y, view.value);
};

/** Every change of fingers starts the gesture again from where the photo is. */
function rebase() {
  start = pointers.size
    ? {
        points: [...pointers.values()],
        centre: centreOnMap(),
        rotationDeg: placement.rotationDeg,
        projPerPx: placement.projPerPx,
      }
    : null;
}

function onDown(e: PointerEvent) {
  following = null;
  e.stopPropagation();
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, posOf(e));
  rebase();
}

function onMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId) || !start) return;
  pointers.set(e.pointerId, posOf(e));
  const now = [...pointers.values()];
  let centre: Pos;
  if (now.length === 1 || start.points.length === 1) {
    centre = {
      x: start.centre.x + now[0].x - start.points[0].x,
      y: start.centre.y + now[0].y - start.points[0].y,
    };
  } else {
    // Two fingers: the photo turns and grows around the point between them, which it follows.
    const [a, b] = start.points;
    const [a2, b2] = now;
    const factor = Math.hypot(b2.x - a2.x, b2.y - a2.y) / Math.hypot(b.x - a.x, b.y - a.y);
    const turn = Math.atan2(b2.y - a2.y, b2.x - a2.x) - Math.atan2(b.y - a.y, b.x - a.x);
    const nextZoom = clampZoom(Math.log2((start.projPerPx * factor) / firstProjPerPx));
    const scale = (firstProjPerPx * 2 ** nextZoom) / start.projPerPx;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const mid2 = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
    const dx = start.centre.x - mid.x;
    const dy = start.centre.y - mid.y;
    centre = {
      x: mid2.x + (dx * Math.cos(turn) - dy * Math.sin(turn)) * scale,
      y: mid2.y + (dx * Math.sin(turn) + dy * Math.cos(turn)) * scale,
    };
    placement.projPerPx = start.projPerPx * scale;
    placement.rotationDeg = normalizeRotationDeg(start.rotationDeg + (turn * 180) / Math.PI);
  }
  const proj = fromCanvas(centre.x, centre.y, view.value);
  const sky = unproject(proj.x, proj.y);
  placement.centerRa = sky.ra;
  placement.centerDec = sky.dec;
}

function onUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  rebase();
}

// ── Valider ──────────────────────────────────────────────────────────────────────────────────────

const stripExtension = (name: string) => name.replace(/\.[^.]+$/, '');

async function validate() {
  if (!file.value || !size.value || saving.value) return;
  saving.value = true;
  try {
    const { width, height } = size.value;
    const placed: ManualPlacement = { ...placement };
    const correspondences = buildSyntheticCorrespondences(
      placed,
      width,
      height,
      props.map.getView(),
    );
    // The objects that fall in the photo need the deep-sky catalogue.
    await catalogsReady();
    const dsoIds = findDSOsInImage(
      computeManualProjMatrix(placed, width, height),
      width,
      height,
    ).map((dso) => dso.id);
    const photo = await uploadPhoto(file.value, correspondences, placed, undefined, {
      dsoIds,
      displayName: stripExtension(file.value.name),
    });
    await removePendingPhoto(props.pendingId);
    emit('placed', photo);
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport :to="mapEl">
    <!-- In the caption size: the desktop's hint holds on one line over the map of a phone. -->
    <div class="mob-map-hint m-caption">{{ t('mobile.gallery.placeHint') }}</div>
    <img
      v-if="url"
      class="mob-placing-photo"
      :class="{ 'mob-placing-photo--ready': size }"
      :src="url"
      :alt="file?.name"
      draggable="false"
      :style="{ transform, opacity }"
      @load="onLoad"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    />
  </Teleport>
  <section
    class="mob-panel mob-placing-panel"
    :class="{ 'mob-sheet--expanded': expanded }"
    :aria-label="t('manual.modeLabel')"
  >
    <div class="mob-placing-grab" v-on="grab.handlers">
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="
          folded ? t('mobile.gallery.placeShowSettings') : t('mobile.gallery.placeHideSettings')
        "
        :aria-expanded="!folded"
        @click="toggleFold"
      >
        <span class="mob-sheet-handle" />
      </button>
    </div>
    <!-- The settings scroll when the panel is short (landscape); Annuler and Valider stay under them. -->
    <!-- Folding slides the settings away under the handle (their height goes to the map). -->
    <div
      class="mob-placing-fold"
      :class="{ 'mob-placing-fold--closed': !settingsShown }"
      :inert="!settingsShown"
    >
      <div class="mob-placing-settings mob-scroll">
        <div class="mob-form-row mob-placing-search">
          <!-- Typing happens on the search page: this field only opens it, as the Ciel map's own. -->
          <PhoneSearch
            readonly
            :placeholder="t('mobile.sky.searchShort')"
            :label="t('search.placeholder')"
            @click="emit('search')"
          />
        </div>
        <PhoneSliderRow
          v-model="rotation"
          :label="t('manual.rotation')"
          :display="`${rotation}°`"
          :min="-180"
          :max="180"
        />
        <PhoneSliderRow
          v-model="zoom"
          :label="t('manual.photoZoom')"
          :display="formatZoomPercent(placement.projPerPx, firstProjPerPx)"
          :min="ZOOM_MIN"
          :max="ZOOM_MAX"
          :step="0.1"
        />
        <PhoneSliderRow
          v-model="opacity"
          :label="t('photos.opacity')"
          :display="opacity.toFixed(2)"
          :min="0.1"
          :max="1"
          :step="0.05"
        />
        <PhoneToggleRow v-model="mirror" :title="t('manual.mirrorX')" />
      </div>
    </div>
    <div class="mob-sheet-footer">
      <PhoneButton size="lg" @click="emit('cancel')">{{ t('manual.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!size || saving" @click="validate">
        {{ saving ? t('manual.processing') : t('manual.validate') }}
      </PhoneButton>
    </div>
  </section>
</template>
