<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { photoAsShown, quarterTurnsOf } from '@myastrosky/core/photo-rotation';
import { getGearSetups, getPhotos, photoFileUrl, rotatePhotoAPI } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { useErrorToast } from '../composables/useErrorToast';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { usePhotoOverlay } from '../composables/usePhotoOverlay';
import { setStatusBarHidden } from '../platform-device';
import { useLandscape } from '../composables/useLandscape';
import {
  autoRotateLandscape,
  loadPhotoDisplay,
  shownQuarterTurns,
  turnsForNextQuarter,
} from '../photo-display';
import { skyPhotoFocus } from '../composables/useSkySelection';
import { galleryFilters, galleryShownPhotos, setLastViewedPhoto } from '../gallery-display';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhotoInfoSheet from './gallery/PhotoInfoSheet.vue';
import PhotoViewButtons from './gallery/PhotoViewButtons.vue';
import { pendingWcs, useWcsLoad } from '../composables/useWcsLoad';
import moreIcon from '../icons/more-vertical.svg?raw';
import resetIcon from '../icons/rotate-ccw.svg?raw';

// A photo's own screen, from the boards "Photo, détail", "Photo, zoom" and "Photo, informations": the photo on a dark
// stage, the top bar with the photo's name, and the sheet of its information. The whole photo is fitted under the bar,
// so that nothing of it stays hidden behind the bar; zoomed, it runs behind the bar, which stays readable over it. Two
// fingers and a double tap zoom; the button that shows the photo whole again is there only while it is zoomed. The
// top bar's "Affichage" button opens a column of buttons (board "Photo, boutons d'affichage"): the map, the photo's
// objects and points of interest drawn over it (board "Photo, objets affichés"), turning it and its information. "Faire
// pivoter à droite" shows the photo turned a quarter more (as the desktop's photo detail): its file is not changed, and
// the photo keeps its place on the sky. One tap on the photo hides the bar and the buttons (board "Photo, barres
// masquées"), another brings them back. The sheet's "Charger un fichier WCS" reads the file, then opens the photo's
// editor with what it found filled in, to be checked and saved there.
// On the whole photo (not zoomed), swiping sideways goes to the next or previous photo in the gallery's order, with its
// search, filters and sort (board "Photo, glisser vers la suivante"): the photo follows the finger with its neighbour
// beside it, which is loaded beforehand (its thumbnail until then); let go past a third of the width, or flicked, it
// slides to the neighbour, else back. The address is replaced, so that Back goes to the gallery, which shows the last
// photo seen.
const route = useRoute();
const router = useRouter();

const photo = ref<Photo | null>(null);
const infoOpen = ref(false);
const buttonsOpen = ref(false);
const barsHidden = ref(false);
const turning = ref(false);
const { loading: wcsLoading, read: readWcs } = useWcsLoad();
const { showError } = useErrorToast();
// The photo as it is shown, turned: the zoom and what is drawn over it work in its pixels. The turn is the photo's own,
// or, on an upright phone with "Pivoter les photos en paysage" on, a quarter for a landscape photo it has none of
// (board "Réglages, affichage"): that one is only shown, never saved.
loadPhotoDisplay();
const landscape = useLandscape();
const turns = computed(() =>
  photo.value
    ? shownQuarterTurns(photo.value, {
        autoRotate: autoRotateLandscape.value,
        portrait: !landscape.value,
      })
    : 0,
);
const shown = computed(() =>
  photo.value ? photoAsShown({ ...photo.value, quarterTurns: turns.value }) : null,
);
const turnTransform = computed(() => (turns.value ? ` rotate(${turns.value * 90}deg)` : ''));
// A picture that cannot be read leaves the stage with the photo's name.
const broken = ref(false);

// The part of the stage under the top bar: the whole photo is fitted in it.
const area = ref<HTMLElement | null>(null);
const { zoom, zoomed, transform, reset, handlers } = usePhotoZoom(
  area,
  () => ({
    width: shown.value?.width ?? 0,
    height: shown.value?.height ?? 0,
  }),
  {
    onSingleTap: () => (barsHidden.value = !barsHidden.value),
    swipe: { move: onSwipeMove, end: onSwipeEnd },
  },
);

// The gallery's photos in its order, read with the photo; the photo's neighbours in it, if it is there.
const order = ref<Photo[]>([]);
const poiCategories = usePoiCategoriesStore();
const place = computed(() => order.value.findIndex((p) => p.id === photo.value?.id));
const previous = computed(() => (place.value > 0 ? order.value[place.value - 1] : null));
const next = computed(() =>
  place.value >= 0 && place.value < order.value.length - 1 ? order.value[place.value + 1] : null,
);
/** The neighbours there are, each in its pane beside the photo. */
const neighbours = computed(() => {
  const panes: { side: 'previous' | 'next'; photo: Photo }[] = [];
  if (previous.value) panes.push({ side: 'previous', photo: previous.value });
  if (next.value) panes.push({ side: 'next', photo: next.value });
  return panes;
});
/** A neighbour as it is shown: whole, turned as the photo itself would be. */
const neighbourTurns = (p: Photo) =>
  shownQuarterTurns(p, { autoRotate: autoRotateLandscape.value, portrait: !landscape.value });
/** The neighbours whose picture could not be read: their name is shown instead. */
const brokenNeighbours = ref(new Set<string>());

/** How far the photos are slid: by the finger (px), or all the way to a neighbour. */
const slide = ref<number | 'previous' | 'next'>(0);
/** Whether the photos slide by themselves (let go), rather than with the finger. */
const settling = ref(false);
const slideTransform = computed(() => {
  if (slide.value === 'next') return 'translateX(calc(-1 * (100% + var(--photo-swipe-gap))))';
  if (slide.value === 'previous') return 'translateX(calc(100% + var(--photo-swipe-gap)))';
  return slide.value ? `translateX(${slide.value}px)` : '';
});
/** Past the first or the last photo, the photo follows the finger only a little. */
const RESIST = 0.25;
/** The share of the width past which a photo let go slides to its neighbour. */
const PAST = 1 / 3;
/** The speed (px per ms) of a flick that slides to the neighbour whatever the distance. */
const FLICK = 0.5;

function onSwipeMove(dx: number) {
  if (turning.value) return;
  settling.value = false;
  const toward = dx < 0 ? next.value : previous.value;
  slide.value = toward ? dx : dx * RESIST;
}

function onSwipeEnd(dx: number, velocity: number) {
  if (turning.value) return;
  const width = area.value?.clientWidth ?? 0;
  const toward = dx < 0 ? next.value : previous.value;
  const flicked = Math.abs(velocity) > FLICK && Math.sign(velocity) === Math.sign(dx);
  settling.value = true;
  if (!toward || dx === 0 || (Math.abs(dx) < width * PAST && !flicked)) {
    slide.value = 0;
    return;
  }
  slide.value = dx < 0 ? 'next' : 'previous';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) show(toward);
}

/** The slide to a neighbour has ended: it becomes the photo. */
function onSlid(event: TransitionEvent) {
  if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
  settling.value = false;
  if (slide.value === 'next' && next.value) show(next.value);
  else if (slide.value === 'previous' && previous.value) show(previous.value);
}

/** Shows `p` whole, in the place of the photo, and puts its address in place of this one's. */
function show(p: Photo) {
  settling.value = false;
  slide.value = 0;
  broken.value = brokenNeighbours.value.has(p.id);
  reset();
  photo.value = p;
  setLastViewedPhoto(p.id);
  void router.replace(`/gallery/photo/${p.id}`);
}

// What is drawn over the photo: off at first, as on the desktop; the catalogues start from the map's and are this
// photo's own choice afterwards.
const showObjects = ref(false);
const showPois = ref(false);
const catalogs = ref([...useDisplayStore().dsoCatalogs]);
const overlay = ref<HTMLCanvasElement | null>(null);
const { canShowObjects, canShowPois } = usePhotoOverlay({
  canvas: overlay,
  area,
  photo: shown,
  zoom,
  objects: showObjects,
  pois: showPois,
  catalogs,
});

const title = computed(() => photo.value?.originalName ?? '');

async function load() {
  try {
    const id = String(route.params.id);
    const photos = await getPhotos();
    const found = photos.find((p) => p.id === id);
    if (!found) {
      await router.replace('/tabs/gallery');
      return;
    }
    if (found.id !== photo.value?.id) {
      broken.value = false;
      reset();
    }
    photo.value = found;
    setLastViewedPhoto(found.id);
    // The equipments and the kinds of points of interest count only for the gallery's filters on them.
    if (galleryFilters.pois) await poiCategories.ensureLoaded();
    const setups = galleryFilters.setups ? await getGearSetups() : [];
    order.value = galleryShownPhotos(photos, {
      knownSetupIds: new Set(setups.map((s) => s.id)),
      poiCategories: poiCategories.categories,
    });
  } catch (error) {
    reportError('PhotoPage.load', error);
  }
}
onMounted(load);
onIonViewWillEnter(load);

// The photo has the screen: Android's status bar is hidden while this page shows, and comes back when it is left.
onIonViewWillEnter(() => void setStatusBarHidden(true));
onIonViewWillLeave(() => void setStatusBarHidden(false));
onBeforeUnmount(() => void setStatusBarHidden(false));

// As the desktop does: the viewer closes and the map goes to the photo.
function showOnMap() {
  if (!photo.value) return;
  infoOpen.value = false;
  skyPhotoFocus.value = photo.value.id;
  void router.replace('/tabs/sky');
}

const backToGallery = () => void router.replace('/tabs/gallery');

async function rotate() {
  if (!photo.value || turning.value) return;
  turning.value = true;
  try {
    // A quarter further right than what is seen, which is ahead of the photo's own rotation when the screen turned it.
    const presses = turnsForNextQuarter(quarterTurnsOf(photo.value), turns.value);
    for (let i = 0; i < presses; i++) photo.value = await rotatePhotoAPI(photo.value.id);
    broken.value = false;
    reset();
  } catch (error) {
    await showError(error);
  } finally {
    turning.value = false;
  }
}

function edit() {
  if (!photo.value) return;
  infoOpen.value = false;
  void router.push(`/gallery/photo/${photo.value.id}/edit`);
}

async function loadWcs() {
  if (!photo.value) return;
  const photoId = photo.value.id;
  const result = await readWcs(photo.value);
  if (!result || photo.value?.id !== photoId) return;
  pendingWcs.value = { photoId, result };
  edit();
}
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-photo-frame">
        <div class="mob-stage mob-stage--viewer mob-photo-stage" v-on="handlers">
          <header
            class="mob-topbar mob-topbar--overlay mob-photo-bar"
            :class="{ 'mob-photo-bar--hidden': barsHidden }"
            @pointerdown.stop
            @touchstart.stop
          >
            <PhoneBackButton float fallback="/tabs/gallery" />
            <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
            <PhoneIconButton
              float
              :expanded="buttonsOpen"
              :label="t('mobile.photo.display')"
              @click="buttonsOpen = !buttonsOpen"
            >
              <AppIcon :svg="moreIcon" />
            </PhoneIconButton>
          </header>
          <div ref="area" class="mob-photo-area">
            <div
              class="mob-photo-track"
              :class="{ 'mob-photo-track--settling': settling }"
              :style="{ transform: slideTransform }"
              @transitionend="onSlid"
            >
              <template v-if="photo">
                <div v-if="broken" class="mob-stage-caption m-secondary">
                  {{ photo.originalName }}
                </div>
                <img
                  v-else
                  class="mob-photo-view"
                  :class="{ 'mob-photo-view--sideways': turns % 2 === 1 }"
                  :src="photoFileUrl(photo.filename)"
                  :alt="photo.originalName"
                  :style="{ transform: transform + turnTransform }"
                  draggable="false"
                  @error="broken = true"
                />
              </template>
              <canvas ref="overlay" class="mob-photo-overlay" aria-hidden="true" />
              <div
                v-for="{ side, photo: neighbour } in neighbours"
                :key="side"
                class="mob-photo-pane"
                :class="`mob-photo-pane--${side}`"
                aria-hidden="true"
              >
                <div
                  v-if="brokenNeighbours.has(neighbour.id)"
                  class="mob-stage-caption m-secondary"
                >
                  {{ neighbour.originalName }}
                </div>
                <template v-else>
                  <!-- The thumbnail stands in until the picture itself is loaded over it. -->
                  <img
                    v-for="file in neighbour.thumbFilename
                      ? [neighbour.thumbFilename, neighbour.filename]
                      : [neighbour.filename]"
                    :key="file"
                    class="mob-photo-view"
                    :class="{ 'mob-photo-view--sideways': neighbourTurns(neighbour) % 2 === 1 }"
                    :src="photoFileUrl(file)"
                    alt=""
                    :style="{
                      transform: neighbourTurns(neighbour)
                        ? `rotate(${neighbourTurns(neighbour) * 90}deg)`
                        : '',
                    }"
                    draggable="false"
                    @error="file === neighbour.filename && brokenNeighbours.add(neighbour.id)"
                  />
                </template>
              </div>
            </div>
          </div>
          <PhotoViewButtons
            v-show="buttonsOpen && !barsHidden"
            v-model:objects="showObjects"
            v-model:pois="showPois"
            :can-show-objects="canShowObjects"
            :can-show-pois="canShowPois"
            :turning="!photo || turning"
            @pointerdown.stop
            @touchstart.stop
            @map="showOnMap"
            @rotate="rotate"
            @info="infoOpen = true"
          />
          <PhoneIconButton
            v-if="zoomed && !barsHidden"
            float
            class="mob-float-br"
            :label="t('mobile.photo.resetZoom')"
            @pointerdown.stop
            @touchstart.stop
            @click="reset"
          >
            <AppIcon :svg="resetIcon" />
          </PhoneIconButton>
        </div>
      </div>
      <PhotoInfoSheet
        v-if="photo"
        v-model:open="infoOpen"
        v-model:catalogs="catalogs"
        :photo="photo"
        :objects="showObjects"
        :wcs-loading="wcsLoading"
        @edit="edit"
        @wcs="loadWcs"
        @removed="backToGallery"
      />
    </IonContent>
  </IonPage>
</template>
