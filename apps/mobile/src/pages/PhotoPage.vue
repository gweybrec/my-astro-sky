<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { photoAsShown, quarterTurnsOf } from '@myastrosky/core/photo-rotation';
import { photoOverlayCatalogs } from '@myastrosky/core/catalog/dso-registry';
import { getGearSetups, getPhotos, photoFileUrl, rotatePhotoAPI } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { useErrorToast } from '../composables/useErrorToast';
import { useDisplayStore } from '@myastrosky/app-state/stores/display';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { usePhotoOverlay } from '../composables/usePhotoOverlay';
import { catalogsReady } from '../catalogs';
import { setStatusBarHidden } from '../platform-device';
import { useLandscape } from '../composables/useLandscape';
import {
  autoRotateLandscape,
  loadPhotoDisplay,
  shownQuarterTurns,
  turnsForNextQuarter,
} from '../photo-display';
import { skyPhotoFocus } from '../composables/useSkySelection';
import {
  galleryFilters,
  galleryShownPhotos,
  photosWithVisit,
  setLastViewedPhoto,
} from '../gallery-display';
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
// slides to the neighbour, which stays as it is drawn and becomes the photo. The page and its address stay the same, so
// that Back goes to the gallery, which shows the last photo seen.
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
// A picture that cannot be read leaves the stage with the photo's name (by photo id).
const brokenPhotos = ref(new Set<string>());
// The photos whose picture itself has loaded: their thumbnail, which stood in for it, is no longer needed.
const loadedPhotos = ref(new Set<string>());

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
/**
 * The photo and the neighbours there are, each in its pane, keyed by the photo: when a neighbour has slid in, its pane
 * (and its picture, already loaded and drawn) becomes the photo's, so nothing is loaded or drawn again.
 */
type Pane = { side: 'previous' | 'current' | 'next'; photo: Photo };
const panes = computed(() => {
  const out: Pane[] = [];
  if (previous.value) out.push({ side: 'previous', photo: previous.value });
  if (photo.value) out.push({ side: 'current', photo: photo.value });
  if (next.value) out.push({ side: 'next', photo: next.value });
  return out;
});
/** A pane's picture as it is shown: turned as its photo is, and the photo's zoomed and moved as the finger says. */
function pictureTransform(pane: Pane): string {
  const quarters = shownQuarterTurns(pane.photo, {
    autoRotate: autoRotateLandscape.value,
    portrait: !landscape.value,
  });
  const turn = quarters ? `rotate(${quarters * 90}deg)` : '';
  return pane.side === 'current' ? `${transform.value} ${turn}`.trim() : turn;
}
const sideways = (pane: Pane) =>
  shownQuarterTurns(pane.photo, {
    autoRotate: autoRotateLandscape.value,
    portrait: !landscape.value,
  }) %
    2 ===
  1;

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

/** Shows `p` whole, in the place of the photo, on this same page. */
function show(p: Photo) {
  settling.value = false;
  slide.value = 0;
  reset();
  photo.value = p;
  setLastViewedPhoto(p.id);
}

// What is drawn over the photo: off at first, as on the desktop; the catalogues start from the map's and are this
// photo's own choice afterwards. Each photo shown adds the catalogues of the objects it lists, so that they are drawn.
const showObjects = ref(false);
const showPois = ref(false);
const catalogs = ref([...useDisplayStore().dsoCatalogs]);
watch(
  () => photo.value?.id,
  async () => {
    const p = photo.value;
    if (!p) return;
    await catalogsReady();
    if (photo.value === p) catalogs.value = photoOverlayCatalogs(catalogs.value, p.dsoIds);
  },
  { immediate: true },
);
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
    // The photo shown, once there is one: a swipe changes it without changing the address (Ionic would make a new page,
    // empty until loaded, for another address), and coming back from the editor reloads it.
    const id = photo.value?.id ?? String(route.params.id);
    const photos = await photosWithVisit(await getPhotos());
    const found = photos.find((p) => p.id === id);
    if (!found) {
      await router.replace('/tabs/gallery');
      return;
    }
    if (found.id !== photo.value?.id) {
      brokenPhotos.value.delete(found.id);
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
    brokenPhotos.value.delete(photo.value.id);
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
              <div
                v-for="pane in panes"
                :key="pane.photo.id"
                class="mob-photo-pane"
                :class="`mob-photo-pane--${pane.side}`"
                :aria-hidden="pane.side === 'current' ? undefined : 'true'"
              >
                <div v-if="brokenPhotos.has(pane.photo.id)" class="mob-stage-caption m-secondary">
                  {{ pane.photo.originalName }}
                </div>
                <template v-else>
                  <!-- The thumbnail stands in until the picture itself is loaded over it. -->
                  <img
                    v-if="pane.photo.thumbFilename && !loadedPhotos.has(pane.photo.id)"
                    key="thumb"
                    class="mob-photo-view"
                    :class="{ 'mob-photo-view--sideways': sideways(pane) }"
                    :src="photoFileUrl(pane.photo.thumbFilename)"
                    alt=""
                    :style="{ transform: pictureTransform(pane) }"
                    draggable="false"
                  />
                  <img
                    key="picture"
                    class="mob-photo-view"
                    :class="{ 'mob-photo-view--sideways': sideways(pane) }"
                    :src="photoFileUrl(pane.photo.filename)"
                    :alt="pane.side === 'current' ? pane.photo.originalName : ''"
                    :style="{ transform: pictureTransform(pane) }"
                    draggable="false"
                    @load="loadedPhotos.add(pane.photo.id)"
                    @error="brokenPhotos.add(pane.photo.id)"
                  />
                </template>
              </div>
              <canvas ref="overlay" class="mob-photo-overlay" aria-hidden="true" />
            </div>
          </div>
          <PhotoViewButtons
            v-show="buttonsOpen && !barsHidden"
            v-model:objects="showObjects"
            v-model:pois="showPois"
            :can-show-objects="canShowObjects"
            :can-show-pois="canShowPois"
            :turning="!photo || turning"
            :read-only="!!photo?.sharedSkyId"
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
