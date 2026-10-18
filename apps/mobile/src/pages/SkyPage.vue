<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewDidEnter, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { catalogsReady } from '../catalogs';
import {
  clearSkySelection,
  skyFocus,
  skyPhotoFocus,
  skySelection,
} from '../composables/useSkySelection';
import { useBackClose } from '../composables/useBackClose';
import { useErrorToast } from '../composables/useErrorToast';
import { getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { createPhoneSkyMap, type PhoneSkyMap } from '../sky-map-setup';
import { skyPlacement, skyStarPick } from '../sky-modes';
import { framesSheetOpen } from '../sky-frames';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import type { SkyMap } from '@myastrosky/render/sky-map';
import type { Photo, Star } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import AppIcon from '../components/AppIcon.vue';
import SkyLayerButtons from './sky/SkyLayerButtons.vue';
import SkyDisplaySheet from './sky/SkyDisplaySheet.vue';
import SkyObjectSheet from './sky/SkyObjectSheet.vue';
import SkyPhotoSheet from './sky/SkyPhotoSheet.vue';
import SkyFrameSheet from './sky/SkyFrameSheet.vue';
import SkyFramesSheet from './sky/SkyFramesSheet.vue';
import SkyFramePicker, { type FrameTarget } from './sky/SkyFramePicker.vue';
import SkyMosaicSheet from './sky/SkyMosaicSheet.vue';
import SkyPlacement from './sky/SkyPlacement.vue';
import SkyStarPick from './sky/SkyStarPick.vue';
import SkyTimeBar from './sky/SkyTimeBar.vue';
import SkyTopBar from './sky/SkyTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The boards "Ciel" and "Ciel, calques de la carte": the sky map with the search field, the display button and the date
// button over it; the date button switches the map to the sky at a date and brings the column of the map's toggles.
const canvas = ref<HTMLCanvasElement | null>(null);
const mapEl = ref<HTMLElement | null>(null);
const placement = ref<InstanceType<typeof SkyPlacement> | null>(null);
const photoBox = ref<HTMLDivElement | null>(null);
const overlayCanvas = ref<HTMLCanvasElement | null>(null);
const displayOpen = ref(false);
const router = useRouter();
const { showError } = useErrorToast();

// The last reading of the placed photos: going to a photo waits for it.
let photosRead: Promise<void> = Promise.resolve();
const reloadPhotos = () =>
  (photosRead =
    sky?.reloadPhotos().catch((error) => reportError('SkyPage.photos', error)) ??
    Promise.resolve());
let sky: PhoneSkyMap | null = null;
// The photo layer once the map exists (the sheet of a photo needs it).
const photoLayer = shallowRef<PhotoLayer | null>(null);
// The map itself once it exists (a photo being placed needs it).
const skyMap = shallowRef<SkyMap | null>(null);

onMounted(() => {
  if (!canvas.value) return;
  sky = createPhoneSkyMap(canvas.value, {
    photoContainer: photoBox.value!,
    overlayCanvas: overlayCanvas.value ?? undefined,
    onPhotoPlacementError: (photo) =>
      void showError(new Error(t('photos.placementError', { name: photo.originalName }))),
  });
  photoLayer.value = sky.photos;
  skyMap.value = sky.map;
  void reloadPhotos();
  sky.select(skySelection.value);
  // The catalogues load after the first screen: the map fills in once they are there.
  catalogsReady()
    .then(() => sky?.catalogsLoaded())
    .catch((error) => reportError('SkyPage.catalogsReady', error));
});

watch(skySelection, (selection) => sky?.select(selection));

// The observing location may have changed in Réglages while this tab stayed mounted; a search may have chosen an
// object to go to.
onIonViewWillEnter(() => {
  sky?.refreshLocation();
  // A setup may have been added or changed in Réglages: the frames take its size again.
  void fov.loadSpecs();
  // Photos may have been added, changed or deleted in the gallery or by an import while another tab was showing.
  void reloadPhotos();
});
// While a page above the tabs covered it, the map measured nothing; back, it may not have measured itself again yet. A
// move of the map waits for its size (a few frames at most), else it would frame nothing.
const MAP_SIZE_FRAMES = 30;
function whenMapSized(run: () => void, frames = MAP_SIZE_FRAMES) {
  if (!sky) return;
  if (sky.map.getView().width > 0 || frames <= 0) run();
  else requestAnimationFrame(() => whenMapSized(run, frames - 1));
}
onIonViewDidEnter(() => {
  // "Voir sur la carte" of a photo's screen: the map frames that photo.
  const photoId = skyPhotoFocus.value;
  if (photoId) {
    skyPhotoFocus.value = null;
    void photosRead.then(() => whenMapSized(() => sky?.showPhoto(photoId)));
  }
  const focus = skyFocus.value;
  if (!focus) return;
  skyFocus.value = null;
  // A photo being placed goes along to the searched object, at the same size on screen.
  whenMapSized(() => {
    if (placement.value) placement.value.follow(() => sky?.focus(focus));
    else sky?.focus(focus);
  });
});

// The selected object has its sheet; the back button closes it before anything else.
useBackClose(() => skySelection.value !== null, clearSkySelection);

// Placing a waiting photo by hand (board "Placer la photo"): the map takes the whole screen with the photo over it and
// its settings under it. Annuler and the back button go back to where the placement was asked; a placed photo stays on
// the map.
const placing = computed(() => skyPlacement.value);
watch(placing, (now) => {
  if (now) clearSkySelection();
});
// A tap on the map does not select anything while a photo is placed.
watch(skySelection, (selection) => {
  if (selection && placing.value) clearSkySelection();
});
function cancelPlacement() {
  skyPlacement.value = null;
  if (window.history.state?.back) router.back();
}
function photoPlaced(photo: Photo) {
  skyPlacement.value = null;
  void reloadPhotos().then(() => sky?.showPhoto(photo.id));
}
useBackClose(() => placing.value !== null, cancelPlacement);

// Choosing a star on the map for a point of the identification (board "Identifier les étoiles, choisir sur la carte"):
// the map takes the screen with the chosen star under it. Valider, Annuler and the back button open the photo again.
const picking = computed(() => skyStarPick.value);
const inMode = computed(() => placing.value !== null || picking.value !== null);
watch(picking, (now) => {
  if (now) clearSkySelection();
});
watch(skySelection, (selection) => {
  if (selection && picking.value) clearSkySelection();
});
function endPick(star: Star | null) {
  const pick = skyStarPick.value;
  skyStarPick.value = null;
  if (!pick) return;
  pick.done(star);
  void router.push(pick.returnTo);
}
useBackClose(
  () => picking.value !== null,
  () => endPick(null),
);
const onSkyView = (listener: () => void) => sky?.onView(listener) ?? (() => undefined);

const time = useSkyTimeStore();
const located = computed(() => time.lat !== null && time.lon !== null);
const openLocation = () => void router.push('/settings/location');

// A chip of the selected photo goes to that deep-sky object, as a search result does.
function goToDso(id: string) {
  const dso = getDSOById(id);
  if (!dso) return;
  skySelection.value = { kind: 'dso', dso };
  skyFocus.value = { ra: dso.ra, dec: dso.dec, scale: 1200 };
  const focus = skyFocus.value;
  skyFocus.value = null;
  sky?.focus(focus);
}
const photoRemoved = () => {
  clearSkySelection();
  void reloadPhotos();
};

// The frames (fields of view). The selected frame has its sheet (board "Ciel, cadre sélectionné"); a frame and an
// object are not selected together. "Ajouter un cadre" of an object opens "Créer un cadre".
const fov = useFovFramesStore();
const activeFrame = computed(() =>
  fov.framesVisible && !inMode.value ? (fov.renderables.find((f) => f.active) ?? null) : null,
);
watch(
  () => activeFrame.value?.id,
  (id) => {
    if (id) clearSkySelection();
  },
);
watch(skySelection, (selection) => {
  if (selection && activeFrame.value) sky?.map.selectFrame(null);
});
const releaseFrame = () => sky?.map.selectFrame(null);
useBackClose(() => activeFrame.value !== null, releaseFrame);

const pickerOpen = ref(false);
const pickerTarget = ref<FrameTarget | null>(null);
const pickerKind = ref<'frame' | 'mosaic'>('frame');
function openFramePicker(kind: 'frame' | 'mosaic') {
  pickerKind.value = kind;
  const s = skySelection.value;
  if (!s || s.kind === 'photo') return;
  pickerTarget.value =
    s.kind === 'dso'
      ? { dsoId: s.dso.id, ra: s.dso.ra, dec: s.dso.dec, name: s.dso.displayName || s.dso.id }
      : { dsoId: null, ra: s.star.ra, dec: s.star.dec, name: s.star.name || `HIP ${s.star.hip}` };
  pickerOpen.value = true;
}
// A plan picked: the map goes to the object and "Contours de champ" shows that plan's frames, as the desktop opens
// its frame manager. A free frame: the map frames it, and its sheet opens.
function framePlanPicked() {
  const target = pickerTarget.value;
  clearSkySelection();
  if (target) sky?.focus({ ra: target.ra, dec: target.dec, scale: 1200 });
  framesSheetOpen.value = true;
}
function frameFreeAdded() {
  clearSkySelection();
  const added = fov.renderables.find((f) => f.active);
  if (added) showFrame(added.id);
}
// "Modifier la mosaïque" of a plan mosaic's sheet: the mosaic form, filled.
const mosaicEdit = ref<{ planId: string; mosaicId: string } | null>(null);
const mosaicEditOpen = ref(false);
function openMosaicEdit(planId: string, mosaicId: string) {
  mosaicEdit.value = { planId, mosaicId };
  mosaicEditOpen.value = true;
}
function mosaicEdited() {
  const edited = fov.renderables.find((f) => f.active);
  if (edited) showFrame(edited.id);
}
// Brings a selected frame to the middle of the part of the map its sheet leaves free (above it in portrait, right of
// it in landscape): once the map has the frame (Vue's next update) and the sheet has its size (the next drawn frame).
function showFrame(id: string) {
  void nextTick(() =>
    requestAnimationFrame(() => {
      const map = sky?.map;
      if (!map) return;
      map.setCover(sheetCover());
      map.centerFrameInView(id);
      map.setCover({ left: 0, bottom: 0 });
    }),
  );
}
// The sheet's place in the map from its layout box, not its box on screen: it is still sliding in.
function sheetCover() {
  const map = mapEl.value;
  const sheet = map?.querySelector<HTMLElement>('.mob-map-sheet');
  if (!map || !sheet) return { left: 0, bottom: 0 };
  const width = map.clientWidth;
  const height = map.clientHeight;
  const sheetRight = sheet.offsetLeft + sheet.offsetWidth;
  const above = Math.max(0, sheet.offsetTop);
  const right = Math.max(0, width - sheetRight);
  // The larger free part: right of the sheet, or above it.
  return right * height > above * width
    ? { left: sheetRight, bottom: 0 }
    : { left: 0, bottom: height - sheet.offsetTop };
}

const openSearch = () => void router.push('/sky/search');
const openInGallery = (photoId: string) => void router.push(`/gallery/photo/${photoId}`);
const editPhoto = (photoId: string) => void router.push(`/gallery/photo/${photoId}/edit`);

onBeforeUnmount(() => {
  sky?.destroy();
  sky = null;
  photoLayer.value = null;
});
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-sky-frame" :class="{ 'mob-map-mode': inMode }">
        <header v-if="inMode" class="mob-topbar">
          <PhoneBackButton :action="placing ? cancelPlacement : () => endPick(null)" />
          <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
            {{ placing ? t('manual.modeLabel') : t('modal.mapPickTooltip') }}
          </h1>
        </header>
        <main ref="mapEl" class="mob-map">
          <canvas ref="canvas" class="mob-sky-canvas" />
          <div ref="photoBox" class="mob-photo-layer" />
          <canvas ref="overlayCanvas" class="mob-sky-overlay" />
          <SkyTopBar
            v-if="!inMode"
            @search="openSearch"
            @display="displayOpen = true"
            @frames="framesSheetOpen = true"
          />
          <!-- First start: no observing location yet, the time and place of the sky cannot be shown. -->
          <div v-if="!located && !inMode" class="mob-map-prompt">
            <p class="m-body">{{ t('targets.location.notSet') }}</p>
            <PhoneButton variant="action" size="lg" @click="openLocation">
              <AppIcon :svg="mapPinIcon" />{{ t('targets.location.label') }}
            </PhoneButton>
          </div>
          <!-- The time bar and the toggles of the map belong to the date mode: the live sky has neither. -->
          <template v-if="time.mode === 'date' && !inMode">
            <SkyTimeBar />
            <SkyLayerButtons />
          </template>
          <Transition name="mob-sheet-slide">
            <SkyPhotoSheet
              v-if="skySelection?.kind === 'photo' && photoLayer"
              :key="skySelection.photo.id"
              :photo="skySelection.photo"
              :layer="photoLayer"
              @close="clearSkySelection"
              @removed="photoRemoved"
              @dso="goToDso"
              @gallery="openInGallery(skySelection.photo.id)"
              @edit="editPhoto(skySelection.photo.id)"
            />
            <SkyObjectSheet
              v-else-if="skySelection && skySelection.kind !== 'photo'"
              :selection="skySelection"
              @close="clearSkySelection"
              @add-frame="openFramePicker('frame')"
              @add-mosaic="openFramePicker('mosaic')"
            />
            <SkyFrameSheet
              v-else-if="activeFrame && skyMap"
              :key="activeFrame.id"
              :frame="activeFrame"
              :map="skyMap"
              @close="releaseFrame"
              @edit-mosaic="openMosaicEdit"
            />
          </Transition>
        </main>
        <SkyPlacement
          v-if="placing && skyMap && mapEl"
          ref="placement"
          :key="placing.pendingId"
          :map="skyMap"
          :map-el="mapEl"
          :pending-id="placing.pendingId"
          :on-view="onSkyView"
          @cancel="cancelPlacement"
          @placed="photoPlaced"
          @search="openSearch"
        />
        <SkyStarPick
          v-else-if="picking && skyMap"
          :map="skyMap"
          :point="picking.point"
          @cancel="endPick(null)"
          @picked="endPick"
        />
      </div>
      <SkyDisplaySheet v-model:open="displayOpen" />
      <SkyFramesSheet v-model:open="framesSheetOpen" :map="skyMap" @show="showFrame" />
      <SkyFramePicker
        v-if="pickerTarget"
        v-model:open="pickerOpen"
        :target="pickerTarget"
        :kind="pickerKind"
        @plan="framePlanPicked"
        @free="frameFreeAdded"
      />
      <SkyMosaicSheet
        v-if="mosaicEdit"
        v-model:open="mosaicEditOpen"
        :dest="{ kind: 'plan', planId: mosaicEdit.planId }"
        :mosaic-id="mosaicEdit.mosaicId"
        @done="mosaicEdited"
      />
    </IonContent>
  </IonPage>
</template>

<style>
.mob-sky-frame {
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top, 0);
}
.mob-sky-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
