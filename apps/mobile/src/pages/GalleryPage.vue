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
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import PhoneRow from '../components/PhoneRow.vue';
import { addImportFiles } from '../composables/usePhotoImport';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { useGrowingList } from '../composables/useGrowingList';
import {
  loadPendingPhotos,
  pendingPhotos,
  removePendingPhoto,
  type PendingState,
} from '../pending-photos';
import { resumePendingSolves, solvePendingOnline, solvedPhotoCount } from '../pending-solve';
import {
  clearGalleryFilters,
  galleryFilters,
  gallerySort,
  loadGalleryDisplay,
  photosPerLine,
  setGallerySort,
  type Orientation,
} from '../gallery-display';
import {
  filterGalleryPhotos,
  GALLERY_SORT_LABEL_KEYS,
  GALLERY_SORTS,
  sortGalleryPhotos,
  type GallerySort,
} from '@myastrosky/core/gallery-filter';
import { skyPlacement } from '../sky-modes';
import { endIdentify } from '../star-identify-session';
import PlacementMethodSheet from './gallery/PlacementMethodSheet.vue';
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
// waits, or whose solve failed, asks how to place it; a photo solved online becomes an ordinary tile. A tap on a
// placed photo opens its own screen.
const router = useRouter();
const { showError } = useErrorToast();
const { confirm } = useConfirm();

// null until the photos are read; the empty state shows only once the backend has answered with none.
const photos = ref<Photo[] | null>(null);
const adding = ref(false);
/** The waiting photo whose placement method is being chosen. */
const placingId = ref<string | null>(null);
const methodOpen = ref(false);

/** The equipments' names by id: a photo's equipment is its first chip. */
const setupNames = ref(new Map<string, string>());
const poiCategories = usePoiCategoriesStore();

/** The chips of a photo, in the order of the desktop's gallery card. */
function tagsOf(photo: Photo): PhotoTag[] {
  return photoTags(
    {
      setupName: photo.gearSetupId ? setupNames.value.get(photo.gearSetupId) : undefined,
      pois: photo.pointsOfInterest,
      labels: photo.labels,
      dsoIds: photo.dsoIds,
    },
    poiCategories.categories,
  );
}

// The photos the search and the filters of the "Affichage" sheet keep, in the order of the "Trier par" sheet (the
// desktop gallery's).
const shownPhotos = computed(() =>
  sortGalleryPhotos(
    filterGalleryPhotos(photos.value ?? [], galleryFilters, {
      knownSetupIds: new Set(setupNames.value.keys()),
      poiCategories: poiCategories.categories,
    }),
    gallerySort.value,
  ),
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
    sortOpen.value = false;
  },
});

// The cards are drawn a part at a time as the grid is scrolled (a gallery can hold hundreds of photos).
const TILES_CHUNK = 24;
const growing = useGrowingList(() => shownPhotos.value, TILES_CHUNK);
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
const landscape =
  typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: landscape)') : null;
const orientation = ref<Orientation>(landscape?.matches ? 'landscape' : 'portrait');
const onTurn = () => (orientation.value = landscape?.matches ? 'landscape' : 'portrait');
landscape?.addEventListener('change', onTurn);
onBeforeUnmount(() => landscape?.removeEventListener('change', onTurn));
loadGalleryDisplay();
const gridStyle = computed(() => ({
  '--photos-per-line': photosPerLine.portrait,
  '--photos-per-line-landscape': photosPerLine.landscape,
}));

/** What the chip of a waiting photo says. */
const PENDING_TEXT: Record<PendingState, string> = {
  toPlace: 'mobile.gallery.toPlace',
  solving: 'mobile.gallery.solving',
  failed: 'batch.statusFailed',
};
const waiting = computed(() =>
  pendingPhotos.value.map((p) => ({
    id: p.id,
    name: p.name,
    busy: p.state === 'solving',
    state: t(PENDING_TEXT[p.state]),
  })),
);

function chooseMethod(tile: { id: string; busy: boolean }) {
  if (tile.busy) return;
  placingId.value = tile.id;
  methodOpen.value = true;
}

function placeByHand() {
  if (!placingId.value) return;
  skyPlacement.value = { pendingId: placingId.value };
  void router.push('/tabs/sky');
}

// Identifying stars starts with no point, even when an earlier identification of this photo was left.
function identify() {
  if (!placingId.value) return;
  endIdentify(placingId.value);
  void router.push(`/gallery/identify/${placingId.value}`);
}

// A waiting photo is deleted after the same question as a placed one; it was only kept on the phone.
async function deleteWaiting() {
  const photo = pendingPhotos.value.find((p) => p.id === placingId.value);
  if (!photo) return;
  const ok = await confirm({
    title: t('photos.deleteConfirmTitle'),
    message: t('photos.deleteConfirmMessage', { name: photo.name }),
    confirmLabel: t('photos.deleteConfirmAction'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await removePendingPhoto(photo.id);
  } catch (error) {
    await showError(error);
  }
}

function solveOnline() {
  if (placingId.value) void solvePendingOnline(placingId.value);
}
const isEmpty = computed(
  () => photos.value !== null && photos.value.length === 0 && waiting.value.length === 0,
);
/** Photos there are, but the search or the filters keep none of them. */
const noMatch = computed(
  () =>
    !isEmpty.value &&
    !!photos.value?.length &&
    shownPhotos.value.length === 0 &&
    !waiting.value.length,
);

// Whether the tab is shown. Left (another tab chosen), the pictures still loading stop and a reading that ends then is
// dropped: the next showing reads the photos again.
const active = ref(true);
let running: Promise<void> | null = null;
/** Reads the waiting and placed photos; a reading already running (the page's first showing) is shared. */
function load() {
  running ??= (async () => {
    try {
      await loadPendingPhotos();
      await resumePendingSolves();
    } catch (error) {
      reportError('GalleryPage.loadPendingPhotos', error);
    }
    await loadPhotos();
  })().finally(() => (running = null));
  return running;
}
async function loadPhotos() {
  try {
    const read = await getPhotos();
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
// A photo solved while the gallery is shown joins the placed ones.
watch(solvedPhotoCount, loadPhotos);

const chooseFiles = () => addPicked(() => pickFiles(PHOTO_FILE_TYPES, true));
const chooseFromPhone = () => addPicked(pickGalleryPhotos);

async function addPicked(pick: () => Promise<File[]>) {
  try {
    const files = await pick();
    if (files.length === 0) return;
    if (addImportFiles(files) === 0) {
      void showError(new Error(t('errors.invalidPhotoFormat')));
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
      <div class="mob-scroll mob-page-fill" @scroll.passive="growing.onScroll">
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
        <div v-else class="mob-photo-grid" :style="gridStyle">
          <PhotoTile
            v-for="tile in waiting"
            :key="tile.id"
            :name="tile.name"
            :state="tile.state"
            :busy="tile.busy"
            @click="chooseMethod(tile)"
          />
          <PhotoTile
            v-for="tile in tiles"
            :key="tile.id"
            :name="tile.name"
            :picture="tile.picture"
            :turns="tile.turns"
            :paused="!active"
            :tags="tile.tags"
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
    <PlacementMethodSheet
      v-model:open="methodOpen"
      deletable
      @delete="deleteWaiting"
      @online="solveOnline"
      @identify="identify"
      @hand="placeByHand"
    />
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
