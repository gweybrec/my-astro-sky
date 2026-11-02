<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  onIonViewDidEnter,
  onIonViewWillEnter,
  onIonViewWillLeave,
  useIonRouter,
} from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { catalogsReady } from '../catalogs';
import { photoMediumsMade, photoSizesRepaired } from '../photo-sizes';
import {
  clearSkySelection,
  skyFocus,
  skyLayersOpen,
  skyPhotoFocus,
  skySelection,
} from '../composables/useSkySelection';
import { useBackClose } from '../composables/useBackClose';
import { useErrorToast } from '../composables/useErrorToast';
import { getDSOById } from '@myastrosky/core/catalog/dso-registry';
import { createPhoneSkyMap, currentSkyMap, type PhoneSkyMap } from '../sky-map-setup';
import {
  skyPlacement,
  skyPlanView,
  skyRegionDraw,
  skyRegionView,
  skyStarPick,
  skyTargetView,
} from '../sky-modes';
import { skyDrawOrder } from '../sky-draw-order';
import { framesSheetOpen } from '../sky-frames';
import { openPageStill, swapPagesUnseen } from '../tab-navigation';
import { useFovFramesStore } from '@myastrosky/app-state/stores/fov-frames';
import type { SkyMap } from '@myastrosky/render/sky-map';
import type { Photo, Star } from '@myastrosky/core/types';
import type { PhotoLayer } from '@myastrosky/render/photo-layer';
import AppIcon from '../components/AppIcon.vue';
import SkyLayersSheet from './sky/SkyLayersSheet.vue';
import SkyDisplaySheet from './sky/SkyDisplaySheet.vue';
import SkyObjectSheet from './sky/SkyObjectSheet.vue';
import SkyPhotoSheet from './sky/SkyPhotoSheet.vue';
import SkyFrameSheet from './sky/SkyFrameSheet.vue';
import PhoneMapSheetHost from '../components/PhoneMapSheetHost.vue';
import SkyFramesSheet from './sky/SkyFramesSheet.vue';
import SkyFramePicker, { type FrameTarget } from './sky/SkyFramePicker.vue';
import SkyMosaicSheet from './sky/SkyMosaicSheet.vue';
import SkyPlacement from './sky/SkyPlacement.vue';
import SkyStarPick from './sky/SkyStarPick.vue';
import SkyRegionDraw from './sky/SkyRegionDraw.vue';
import SkyRegionView from './sky/SkyRegionView.vue';
import SkyTimeBar from './sky/SkyTimeBar.vue';
import SkyTopBar from './sky/SkyTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import telescopeIcon from '@icons/telescope.svg?raw';

// The boards "Ciel" and "Ciel, calques de la carte": the sky map with the search field, the display button and the
// calendar button over it; the calendar button opens the layers sheet, whose first switch puts the map on the sky at a
// date (the time bar then shows).
const canvas = ref<HTMLCanvasElement | null>(null);
const mapEl = ref<HTMLElement | null>(null);
const placement = ref<InstanceType<typeof SkyPlacement> | null>(null);
const photoBox = ref<HTMLDivElement | null>(null);
const overlayCanvas = ref<HTMLCanvasElement | null>(null);
const displayOpen = ref(false);
const router = useRouter();
const { showError } = useErrorToast();
const fov = useFovFramesStore();

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
  currentSkyMap.value = sky.map;
  void reloadPhotos();
  sky.select(skySelection.value);
  // The catalogues load after the first screen: the map fills in once they are there.
  catalogsReady()
    .then(() => sky?.catalogsLoaded())
    .catch((error) => reportError('SkyPage.catalogsReady', error));
  // A photo the start-up repair gave a size to is shown again with it.
  void photoSizesRepaired().then((repaired) => {
    if (repaired > 0) void reloadPhotos();
  });
  // So are the large photos once their medium-sized copies are made.
  void photoMediumsMade().then((made) => {
    if (made > 0) void reloadPhotos();
  });
});

watch(skySelection, (selection) => sky?.select(selection));

// The observing location may have changed in Réglages while this tab stayed mounted; a search may have chosen an
// object to go to.
onIonViewWillEnter(() => {
  sky?.setActive(true);
  sky?.refreshLocation();
  // A setup may have been added or changed in Réglages: the frames take its size again.
  void fov.loadSpecs();
  // Photos may have been added, changed or deleted in the gallery or by an import while another tab was showing.
  void reloadPhotos();
});
// Another tab chosen: the pictures still loading stop, so that tab is not slowed down.
onIonViewWillLeave(() => sky?.setActive(false));
// The map's sheets open only while the page shows (another tab or a page pushed over the tabs hides it, and Ionic
// draws them at the app's root, over any page).
const mapShown = computed(() => router.currentRoute.value.path === '/tabs/sky');
// While a page above the tabs covered it, the map measured nothing; back, it may not have measured itself again yet. A
// move of the map waits for its size (a few frames at most), else it would frame nothing.
const MAP_SIZE_FRAMES = 30;
function whenMapSized(run: () => void, frames = MAP_SIZE_FRAMES) {
  if (!sky) return;
  if (sky.map.getView().width > 0 || frames <= 0) run();
  else requestAnimationFrame(() => whenMapSized(run, frames - 1));
}
onIonViewDidEnter(() => {
  // "Voir sur la carte" of a photo's screen, or a photo chosen in the search: the map frames that photo, beside its
  // sheet when the search selected it.
  const photoId = skyPhotoFocus.value;
  if (photoId) {
    skyPhotoFocus.value = null;
    void photosRead.then(() =>
      whenMapSized(() =>
        besideSheet(({ width, height }) => sky?.showPhoto(photoId, width, height)),
      ),
    );
  }
  const focus = skyFocus.value;
  if (!focus) return;
  skyFocus.value = null;
  // A photo being placed goes along to the searched object, at the same size on screen.
  whenMapSized(() => {
    if (placement.value) placement.value.follow(() => sky?.focus(focus));
    // A setup's field ("Afficher sur la carte" of a plan) comes with its frame's sheet: framed in the part left free.
    else if (focus.fov) besideSheet(({ width, height }) => sky?.focus(focus, width, height));
    else sky?.focus(focus);
  });
});

// The selected object has its sheet; the back button closes it before anything else.
useBackClose(() => skySelection.value !== null, clearSkySelection);
// The layers sheet closes with the back button.
useBackClose(
  () => skyLayersOpen.value,
  () => (skyLayersOpen.value = false),
);

// Placing a waiting photo by hand (board "Placer la photo"): the map takes the whole screen with the photo over it and
// its settings under it. Annuler and the back button go back to where the placement was asked; a placed photo stays on
// the map. Repositionner of a photo's sheet moves a placed photo again on the same screen: once done or given up, the
// photo's sheet opens again.
const placing = computed(() => skyPlacement.value);
const placingKey = computed(() => {
  const p = placing.value;
  return p ? ('pendingId' in p ? p.pendingId : p.photoId) : undefined;
});
const repositioned = computed(() => {
  const p = placing.value;
  if (!p || !('photoId' in p)) return null;
  return photoLayer.value?.getPlacedPhotos().find((placed) => placed.photo.id === p.photoId)?.photo;
});
function startReposition(photoId: string) {
  skyPlacement.value = { photoId };
}
watch(placing, (now) => {
  if (now) clearSkySelection();
});
// A tap on the map does not select anything while a photo is placed.
watch(skySelection, (selection) => {
  if (selection && placing.value) clearSkySelection();
});
function cancelPlacement() {
  const photo = repositioned.value;
  skyPlacement.value = null;
  if (photo) skySelection.value = { kind: 'photo', photo };
  else if (window.history.state?.back) router.back();
}
function photoRepositioned(photo: Photo) {
  skyPlacement.value = null;
  skySelection.value = { kind: 'photo', photo };
  void reloadPhotos();
}
function photoPlaced(photo: Photo) {
  skyPlacement.value = null;
  void reloadPhotos().then(() => sky?.showPhoto(photo.id));
}
useBackClose(() => placing.value !== null, cancelPlacement);

// Choosing a star on the map for a point of the identification (board "Identifier les étoiles, choisir sur la carte"):
// the map takes the screen with the chosen star under it. Valider, Annuler and the back button open the photo again.
const picking = computed(() => skyStarPick.value);
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

// Drawing a sky region (board "Dessiner une région") and showing a saved one (board "Voir une région"), asked by the
// regions page of Cibles: the map takes the screen in local sky. Terminer, Annuler and the back button open that page
// again.
const regionDrawing = computed(() => skyRegionDraw.value);
const regionShown = computed(() => skyRegionView.value);
watch([regionDrawing, regionShown], ([drawing, shown]) => {
  if (drawing || shown) clearSkySelection();
});
watch(skySelection, (selection) => {
  if (selection && (regionDrawing.value || regionShown.value)) clearSkySelection();
});
// The regions page opens again above the Cibles tab, where its back arrow leads (pushed above the Ciel tab, it led there).
async function endRegionMode() {
  const returnTo = skyRegionDraw.value?.returnTo ?? skyRegionView.value?.returnTo;
  skyRegionDraw.value = null;
  skyRegionView.value = null;
  if (!returnTo) return;
  await router.replace('/tabs/targets');
  await router.push(returnTo);
}
useBackClose(() => regionDrawing.value !== null || regionShown.value !== null, endRegionMode);

// Showing a target ("Afficher sur la carte" of its page, board "Ciel, voir une cible"): the map with the setup's frame
// on the target and the frame's sheet, without "Déplacer vers un plan" and "Supprimer le cadre". The frame moves and
// turns as on the map; the object it is anchored to becomes the target (named in the bar), the last one when it is
// dropped on empty sky. The back arrow and the back button open the target's page again, in one press. The frame is a
// preview: leaving removes it and puts the frames back as they were.
const targetShown = computed(() => skyTargetView.value);
const targetId = ref<string | null>(null);
watch(
  targetShown,
  (shown) => {
    targetId.value = shown?.dsoId ?? null;
    if (shown) clearSkySelection();
  },
  { immediate: true },
);
watch(skySelection, (selection) => {
  if (selection && targetShown.value) clearSkySelection();
});
const targetFrameDso = computed(() => {
  const id = targetShown.value?.frameId;
  return id ? (fov.renderables.find((f) => f.id === id)?.dsoId ?? null) : null;
});
watch(targetFrameDso, (id) => {
  if (id) targetId.value = id;
});
const targetTitle = computed(() => {
  const shown = targetShown.value;
  if (!shown) return '';
  const id = targetId.value ?? shown.dsoId;
  if (id === shown.dsoId) return shown.name;
  const dso = getDSOById(id);
  return dso?.displayName || dso?.catalogs[0] || id;
});
const ionRouter = useIonRouter();
const openStill = (path: string) => openPageStill(ionRouter, path);
async function endTargetView() {
  const shown = skyTargetView.value;
  if (!shown) return;
  const id = targetId.value ?? shown.dsoId;
  skyTargetView.value = null;
  if (shown.frameId) fov.removeFrame(shown.frameId);
  if (JSON.stringify(fov.selection) !== JSON.stringify(shown.frames.selection))
    fov.setSelection(shown.frames.selection);
  fov.setFramesVisible(shown.frames.visible);
  // The target's page opens again above its tab, with the pages under it so that its back arrow leads to them; out of
  // sight, without a slide or a glimpse of each.
  await swapPagesUnseen(async () => {
    await router.replace(`/tabs/${shown.tab}`);
    for (const page of shown.pages) await openStill(page);
    await openStill(id === shown.dsoId ? shown.page : shown.pageOf(id));
  });
}
useBackClose(() => targetShown.value !== null, endTargetView);

// Showing a plan ("Afficher sur la carte" of its page, board "Ciel, contours de champ d'un plan"): the map with the
// plan's frames and the frames' sheet on them, as the desktop opens its frame manager. Dragged down, the sheet closes
// whole (a strip at the bottom of the screen would be under the system's gesture area); the frames button of the bar
// opens it again. Its frames are the plan's own: a tap opens a frame's sheet with all its actions. The back arrow and
// the back button open the plan's page again; leaving puts the frames back as they were.
const planShown = computed(() => skyPlanView.value);
watch(planShown, (shown) => {
  if (shown) clearSkySelection();
});
watch(skySelection, (selection) => {
  if (selection && planShown.value) clearSkySelection();
});
async function endPlanView() {
  const shown = skyPlanView.value;
  if (!shown) return;
  skyPlanView.value = null;
  framesSheetOpen.value = false;
  sky?.map.selectFrame(null);
  if (JSON.stringify(fov.selection) !== JSON.stringify(shown.frames.selection))
    fov.setSelection(shown.frames.selection);
  fov.setFramesVisible(shown.frames.visible);
  // The plan's page opens again above the Plans tab, where its back arrow leads; out of sight, without a slide.
  await swapPagesUnseen(async () => {
    await router.replace('/tabs/plans');
    await openStill(shown.returnTo);
  });
}
useBackClose(() => planShown.value !== null, endPlanView);

// The bar of the mode on: its title and what its back arrow does.
const modeBar = computed(() => {
  if (placing.value) return { title: t('manual.modeLabel'), back: cancelPlacement };
  if (picking.value) return { title: t('modal.mapPickTooltip'), back: () => endPick(null) };
  if (regionDrawing.value)
    return { title: t('mobile.targets.regionDrawTitle'), back: endRegionMode };
  if (regionShown.value) return { title: regionShown.value.region.name, back: endRegionMode };
  if (targetShown.value) return { title: targetTitle.value, back: endTargetView };
  if (planShown.value) return { title: planShown.value.name, back: endPlanView };
  return null;
});
const inMode = computed(() => modeBar.value !== null);
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
// The frames have their sheet on the map and in the modes showing a target or a plan, not in the other modes.
const activeFrame = computed(() =>
  fov.framesVisible && (!inMode.value || targetShown.value || planShown.value)
    ? (fov.renderables.find((f) => f.active) ?? null)
    : null,
);
const releaseFrame = () => sky?.map.selectFrame(null);
// The sheets of the map (a photo, an object or a star, a frame, the layers) take turns: the one opened last closes
// the others, whichever it is.
const mapSheets = [
  { open: () => skySelection.value !== null, close: clearSkySelection },
  { open: () => activeFrame.value !== null, close: releaseFrame },
  { open: () => skyLayersOpen.value, close: () => (skyLayersOpen.value = false) },
];
for (const sheet of mapSheets) {
  watch(sheet.open, (opened) => {
    if (!opened) return;
    for (const other of mapSheets) if (other !== sheet && other.open()) other.close();
  });
}
// A mode taking the whole screen closes the layers sheet too.
watch(inMode, (mode) => {
  if (mode) skyLayersOpen.value = false;
});
// Showing a target or a plan, the back button leaves the mode at once, sheet and all.
useBackClose(
  () => activeFrame.value !== null && !targetShown.value && !planShown.value,
  releaseFrame,
);

const pickerOpen = ref(false);
const pickerTarget = ref<FrameTarget | null>(null);
const pickerKind = ref<'frame' | 'mosaic'>('frame');
function editObject() {
  const s = skySelection.value;
  if (s?.kind === 'dso') void router.push(`/sky/object/${encodeURIComponent(s.dso.id)}/edit`);
}
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
// Runs a move of the map within the part its sheet leaves free (above it in portrait, right of it in landscape), with
// that part's size: once the map has what it moves to (Vue's next update) and the sheet has its size (the next drawn
// frame). Without a sheet the whole map is free.
function besideSheet(move: (free: { width: number; height: number }) => void) {
  void nextTick(() =>
    requestAnimationFrame(() => {
      const map = sky?.map;
      if (!map) return;
      const cover = sheetCover();
      const view = map.getView();
      map.setCover(cover);
      move({ width: view.width - cover.left, height: view.height - cover.bottom });
      map.setCover({ left: 0, bottom: 0 });
    }),
  );
}
// Brings a selected frame to the middle of the part of the map its sheet leaves free.
function showFrame(id: string) {
  besideSheet(() => sky?.map.centerFrameInView(id));
}
// The sheet's place in the map from its room and the height it opens at, not its box on screen: it is still sliding in.
function sheetCover() {
  const map = mapEl.value;
  const room = map?.querySelector<HTMLElement>('.mob-map-sheet-room');
  if (!map || !room) return { left: 0, bottom: 0 };
  const width = map.clientWidth;
  const height = map.clientHeight;
  const sheetRight = room.offsetLeft + room.offsetWidth;
  const sheetTop = room.offsetTop + room.offsetHeight - Number(room.dataset.cover ?? 0);
  const above = Math.max(0, sheetTop);
  const right = Math.max(0, width - sheetRight);
  // The larger free part: right of the sheet, or above it.
  return right * height > above * width
    ? { left: sheetRight, bottom: 0 }
    : { left: 0, bottom: height - sheetTop };
}

const openSearch = () => void router.push('/sky/search');
const openInGallery = (photoId: string) => void router.push(`/gallery/photo/${photoId}`);
const editPhoto = (photoId: string) => void router.push(`/gallery/photo/${photoId}/edit`);
// The display order page measures nothing itself: the photos' outlines are taken here, while the map is on screen.
function openDrawOrder(photoId: string) {
  if (!sky) return;
  skyDrawOrder.value = {
    photoId,
    layer: sky.photos,
    quads: sky.photos.getPhotoCanvasQuads(sky.map.getView()),
  };
  void router.push('/sky/draw-order');
}

onBeforeUnmount(() => {
  sky?.destroy();
  sky = null;
  currentSkyMap.value = null;
  photoLayer.value = null;
});
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div
        class="mob-page-fill mob-sky-frame"
        :class="{
          'mob-map-mode': inMode,
          'mob-map-mode--bare': regionShown || targetShown || planShown,
        }"
      >
        <header v-if="modeBar" class="mob-topbar">
          <PhoneBackButton :action="modeBar.back" />
          <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ modeBar.title }}</h1>
          <PhoneIconButton
            v-if="planShown"
            :label="t('fovOverlay.popupTitle')"
            @click="framesSheetOpen = true"
            ><AppIcon :svg="telescopeIcon"
          /></PhoneIconButton>
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
            @layers="skyLayersOpen = true"
          />
          <!-- First start: no observing location yet, the time and place of the sky cannot be shown. -->
          <div v-if="!located && !inMode" class="mob-map-prompt">
            <p class="m-body">{{ t('targets.location.notSet') }}</p>
            <PhoneButton variant="action" size="lg" @click="openLocation">
              <AppIcon :svg="mapPinIcon" />{{ t('targets.location.label') }}
            </PhoneButton>
          </div>
          <!-- The time bar belongs to the date mode: the live sky has none. -->
          <SkyTimeBar v-if="time.mode === 'date' && !inMode" />
          <PhoneMapSheetHost :shown="mapShown">
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
              @order="openDrawOrder(skySelection.photo.id)"
              @reposition="startReposition(skySelection.photo.id)"
            />
            <SkyObjectSheet
              v-else-if="skySelection && skySelection.kind !== 'photo'"
              :selection="skySelection"
              @close="clearSkySelection"
              @add-frame="openFramePicker('frame')"
              @add-mosaic="openFramePicker('mosaic')"
              @edit="editObject"
            />
            <SkyFrameSheet
              v-else-if="activeFrame && skyMap"
              :key="activeFrame.id"
              :frame="activeFrame"
              :map="skyMap"
              :viewing="!!targetShown"
              @close="releaseFrame"
              @edit-mosaic="openMosaicEdit"
            />
            <SkyLayersSheet v-else-if="skyLayersOpen && !inMode" @close="skyLayersOpen = false" />
          </PhoneMapSheetHost>
        </main>
        <SkyPlacement
          v-if="placing && skyMap && mapEl && ('pendingId' in placing || repositioned)"
          ref="placement"
          :key="placingKey"
          :map="skyMap"
          :map-el="mapEl"
          :pending-id="'pendingId' in placing ? placing.pendingId : undefined"
          :photo="repositioned ?? undefined"
          :layer="repositioned ? (photoLayer ?? undefined) : undefined"
          :on-view="onSkyView"
          @cancel="cancelPlacement"
          @placed="photoPlaced"
          @repositioned="photoRepositioned"
          @search="openSearch"
        />
        <SkyStarPick
          v-else-if="picking && skyMap"
          :map="skyMap"
          :point="picking.point"
          @cancel="endPick(null)"
          @picked="endPick"
        />
        <SkyRegionDraw
          v-else-if="regionDrawing && skyMap && mapEl"
          :map="skyMap"
          :map-el="mapEl"
          @cancel="endRegionMode"
          @saved="endRegionMode"
        />
        <SkyRegionView
          v-else-if="regionShown && skyMap"
          :key="regionShown.region.id"
          :map="skyMap"
          :region="regionShown.region"
        />
      </div>
      <SkyDisplaySheet v-model:open="displayOpen" :layer="photoLayer" />
      <SkyFramesSheet
        v-model:open="framesSheetOpen"
        :map="skyMap"
        :plan-view="!!planShown"
        @show="showFrame"
      />
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
