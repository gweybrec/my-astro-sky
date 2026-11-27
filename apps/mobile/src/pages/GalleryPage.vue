<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { quarterTurnsOf } from '@myastrosky/core/photo-rotation';
import { getGearSetups, getPhotos, photoFileUrl } from '@myastrosky/app-state/api';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import PhoneRow from '../components/PhoneRow.vue';
import { addImportFiles } from '../composables/usePhotoImport';
import { useLandscape } from '../composables/useLandscape';
import { useErrorToast } from '../composables/useErrorToast';
import { useGrowingList } from '../composables/useGrowingList';
import { useKeptScroll } from '../composables/useKeptScroll';
import { pendingPhotos } from '../pending-photos';
import { pendingStateText, storedStateText } from '../pending-display';
import { resumePendingSolves, solvedPhotoCount } from '../pending-solve';
import { isPlacedPhoto } from '@myastrosky/core/photo-placement';
import { followStoredSolves, isFollowingStoredSolve } from '@myastrosky/app-state/stored-solve';
import {
  clearGalleryFilters,
  galleryFilters,
  galleryShownPhotos,
  gallerySort,
  loadGalleryDisplay,
  takeLastViewedPhoto,
  photosPerLine,
  setGallerySort,
  type Orientation,
} from '../gallery-display';
import {
  GALLERY_SORT_LABEL_KEYS,
  GALLERY_SORTS,
  type GallerySort,
} from '@myastrosky/core/gallery-filter';
import GalleryDisplaySheet from './gallery/GalleryDisplaySheet.vue';
import PhotoTile from '../components/PhotoTile.vue';
import PhoneRadioSheet from '../components/PhoneRadioSheet.vue';
import { photoTags, type PhotoTag } from '../photo-tags';
import { PHOTO_FILE_TYPES, pickFiles, pickGalleryPhotos } from '../platform-device';
import sortIcon from '../icons/arrow-up-down.svg?raw';
import slidersIcon from '../icons/sliders.svg?raw';
import folderIcon from '../icons/folder.svg?raw';
import imageIcon from '@icons/image.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// The Galerie tab, from the boards "Galerie", "Galerie, aucune photo", "Galerie, résolutions en cours", "Galerie,
// affichage" and "Galerie, ajouter une photo": the photos as cards with their picture, their file name and, as chips in
// the desktop's order, their equipment, points of interest, labels and objects; before them the imported photos that
// are not on the sky yet with where they stand; the plus that opens the sheet to add photos; and the "Affichage"
// button, which sets how many photos a line holds.
// Choosing files, or pictures of the phone's gallery, opens the import ("Importer des photos"). A tap on a photo that
// waits opens its page "Photo à ajouter" (placement methods and metadata); once stored it becomes an ordinary tile. A
// tap on a stored photo opens its own screen.
const router = useRouter();
const { showError } = useErrorToast();

// null until the photos are read; the empty state shows only once the backend has answered with none.
const photos = ref<Photo[] | null>(null);
const adding = ref(false);

/** The equipments' names by id: a photo's equipment is its first chip. */
const setupNames = ref(new Map<string, string>());
const poiCategories = usePoiCategoriesStore();

/** The chips of a photo, in the order of the desktop's gallery card. */
function tagsOf(photo: Photo): PhotoTag[] {
  return photoTags(
    {
      // A visited sky's photo: the setup as the sender named it, and the sender's kinds of points of interest.
      setupName:
        photo.sharedGear?.setup ??
        (photo.gearSetupId ? setupNames.value.get(photo.gearSetupId) : undefined),
      pois: photo.pointsOfInterest,
      labels: photo.labels,
      dsoIds: photo.dsoIds,
    },
    photo.sharedSkyId ? sharedSkies.visitPoiCategories : poiCategories.categories,
  );
}

// The photos the search and the filters of the "Affichage" sheet keep, in the order of the "Trier par" sheet (the
// desktop gallery's).
// The user's own photos and those of the visited sky shown (board "Galerie, choix du ciel affiché").
const sharedSkies = useSharedSkiesStore();
// A photo stored without a placement is a "À résoudre" tile of its own (`waiting`), not a card of the grid.
const listed = computed(() =>
  photos.value === null
    ? null
    : [
        ...(sharedSkies.ownShown ? photos.value.filter((p) => isPlacedPhoto(p)) : []),
        ...sharedSkies.visitPhotos,
      ],
);
const shownPhotos = computed(() =>
  galleryShownPhotos(listed.value ?? [], {
    knownSetupIds: new Set(setupNames.value.keys()),
    poiCategories: poiCategories.categories,
  }),
);
const sortOpen = ref(false);
const sortOptions = GALLERY_SORTS.map((value) => ({
  value,
  label: t(GALLERY_SORT_LABEL_KEYS[value]),
}));
const sort = computed({
  get: () => gallerySort.value,
  set: (value: GallerySort | undefined) => {
    if (value) setGallerySort(value);
  },
});

// The cards are drawn a part at a time as the grid is scrolled (a gallery can hold hundreds of photos).
const TILES_CHUNK = 24;
const growing = useGrowingList(() => shownPhotos.value, TILES_CHUNK);
// The grid stays where it was while the gallery is hidden (a photo opened over it, another tab): its scroll is not left
// to the WebView, which can lose it on a hidden page far down a long list.
const scrollHost = ref<HTMLElement | null>(null);
// Back from a photo's screen after swiping to other photos, the grid goes to the last one seen.
useKeptScroll(
  scrollHost,
  (id) => growing.showAtLeast(shownPhotos.value.findIndex((p) => p.id === id) + 1),
  { target: takeLastViewedPhoto },
);
const tiles = computed(() =>
  growing.shown.value.map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    picture: photoFileUrl(photo.thumbFilename ?? photo.filename),
    turns: quarterTurnsOf(photo),
    tags: tagsOf(photo),
  })),
);

// How the phone is held, as the stylesheet sees it: each way has its own number of photos per line.
const displayOpen = ref(false);
const landscape = useLandscape();
const orientation = computed<Orientation>(() => (landscape.value ? 'landscape' : 'portrait'));
loadGalleryDisplay();
const gridStyle = computed(() => ({
  '--photos-per-line': photosPerLine.portrait,
  '--photos-per-line-landscape': photosPerLine.landscape,
}));
// Three photos or more to a line: tighter spacing, so a card keeps room for "NGC 7000" beside the "+N" chip.
const dense = computed(() => photosPerLine[orientation.value] >= 3);

// The photos stored without a placement ("À résoudre") are the user's own: shown only while "Mon ciel" is ticked, like the
// placed ones. One whose page is open says where it stands there; the others, where their astrometry.net solve stands.
const unplaced = computed(() => (photos.value ?? []).filter((p) => !isPlacedPhoto(p)));
const waiting = computed(() =>
  sharedSkies.ownShown
    ? unplaced.value.map((photo) => {
        const open = pendingPhotos.value.find((p) => p.id === photo.id);
        return {
          id: photo.id,
          name: photo.originalName,
          busy: open ? open.state === 'solving' : isFollowingStoredSolve(photo.id),
          state: open ? pendingStateText(open, true) : storedStateText(photo),
        };
      })
    : [],
);
const isEmpty = computed(
  () => listed.value !== null && listed.value.length === 0 && waiting.value.length === 0,
);
/** Photos there are, but the search or the filters keep none of them. */
const noMatch = computed(
  () =>
    !isEmpty.value &&
    !!listed.value?.length &&
    shownPhotos.value.length === 0 &&
    !waiting.value.length,
);

// Whether the tab is shown. Left (another tab chosen), the pictures still loading stop and a reading that ends then is
// dropped: the next showing reads the photos again.
const active = ref(true);
let running: Promise<void> | null = null;
/** Reads the photos; a reading already running (the page's first showing) is shared. */
function load() {
  running ??= (async () => {
    try {
      await resumePendingSolves();
    } catch (error) {
      reportError('GalleryPage.resumePendingSolves', error);
    }
    await loadPhotos();
    followWaiting();
  })().finally(() => (running = null));
  return running;
}

/**
 * The photos stored while astrometry.net had not finished: their solve went on there; its result is fetched, without a
 * new upload, and a solved photo joins the placed ones. One whose page is open is followed there.
 */
function followWaiting() {
  const ids = new Set(pendingPhotos.value.map((p) => p.id));
  void followStoredSolves(
    unplaced.value.filter((p) => !ids.has(p.id)),
    { onChange: () => void loadPhotos() },
  );
}
async function loadPhotos() {
  try {
    const read = await getPhotos();
    // The visited sky shown is read once; the store keeps it up to date afterwards.
    if (!sharedSkies.loaded) await sharedSkies.load();
    // Unchanged photos keep their cards as they are, already drawn.
    if (active.value && JSON.stringify(read) !== JSON.stringify(photos.value)) photos.value = read;
  } catch (error) {
    reportError('GalleryPage.getPhotos', error);
  }
  // What the chips need; the photos show without it if it cannot be read.
  try {
    await poiCategories.ensureLoaded();
    setupNames.value = new Map((await getGearSetups()).map((s) => [s.id, s.name]));
  } catch (error) {
    reportError('GalleryPage.chips', error);
  }
}
onMounted(load);
onIonViewWillEnter(() => {
  active.value = true;
  void load();
});
onIonViewWillLeave(() => (active.value = false));
// The solves stopped for want of the network go on as soon as it is back.
const onOnline = () => {
  void resumePendingSolves();
  followWaiting();
};
window.addEventListener('online', onOnline);
onBeforeUnmount(() => window.removeEventListener('online', onOnline));
// A photo solved while the gallery is shown joins the placed ones.
watch(solvedPhotoCount, loadPhotos);

const chooseFiles = () => addPicked(() => pickFiles(PHOTO_FILE_TYPES, true));
const chooseFromPhone = () => addPicked(pickGalleryPhotos);

async function addPicked(pick: () => Promise<File[]>) {
  try {
    const files = await pick();
    if (files.length === 0) return;
    if (addImportFiles(files) === 0) {
      void showError(t('errors.invalidPhotoFormat'));
      return;
    }
    adding.value = false;
    await router.push('/gallery/import');
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneSearch
        v-model="galleryFilters.query"
        :placeholder="t('photos.searchPlaceholder')"
        :label="t('mobile.gallery.searchLabel')"
      />
      <PhoneIconButton :label="t('display.section')" @click="displayOpen = true"
        ><AppIcon :svg="slidersIcon"
      /></PhoneIconButton>
      <PhoneIconButton :label="t('targets.sort.label')" @click="sortOpen = true"
        ><AppIcon :svg="sortIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div ref="scrollHost" class="mob-scroll mob-page-fill" @scroll.passive="growing.onScroll">
        <PhoneEmptyState
          v-if="isEmpty"
          :text="t('mobile.gallery.empty')"
          :button-label="t('batch.modalTitle')"
          :button-icon="plusIcon"
          @action="adding = true"
        />
        <PhoneEmptyState
          v-else-if="noMatch"
          :text="t('gallery.noMatches')"
          :button-label="t('mobile.gallery.clearFilters')"
          @action="(clearGalleryFilters(), (galleryFilters.query = ''))"
        />
        <div
          v-else
          class="mob-photo-grid"
          :class="{ 'mob-photo-grid--dense': dense }"
          :style="gridStyle"
        >
          <PhotoTile
            v-for="tile in waiting"
            :key="tile.id"
            :name="tile.name"
            :state="tile.state"
            :busy="tile.busy"
            @click="router.push(`/gallery/pending/${tile.id}`)"
          />
          <PhotoTile
            v-for="tile in tiles"
            :key="tile.id"
            :name="tile.name"
            :picture="tile.picture"
            :turns="tile.turns"
            :paused="!active"
            :tags="tile.tags"
            :data-keep-id="tile.id"
            @click="router.push(`/gallery/photo/${tile.id}`)"
          />
        </div>
      </div>
      <PhoneFab
        v-if="photos !== null && !isEmpty"
        in-tab
        :label="t('batch.modalTitle')"
        @click="adding = true"
      />
    </IonContent>
    <GalleryDisplaySheet
      v-model:open="displayOpen"
      :orientation="orientation"
      :photos="photos ?? []"
      :setup-names="setupNames"
    />
    <PhoneRadioSheet
      v-model:open="sortOpen"
      v-model:value="sort"
      :title="t('targets.sort.label')"
      :options="sortOptions"
    />
    <PhoneSheet v-model:open="adding" :title="t('batch.modalTitle')">
      <PhoneRow
        button
        :lead="folderIcon"
        :title="t('mobile.gallery.chooseFiles')"
        :subs="[t('mobile.gallery.formats')]"
        @click="chooseFiles"
      />
      <PhoneRow
        button
        :lead="imageIcon"
        :title="t('mobile.gallery.fromPhone')"
        @click="chooseFromPhone"
      />
    </PhoneSheet>
  </IonPage>
</template>
