<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { getPhotos, photoFileUrl } from '@myastrosky/app-state/api';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import PhoneFab from '../components/PhoneFab.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import { addImportFiles } from '../composables/usePhotoImport';
import { useErrorToast } from '../composables/useErrorToast';
import { loadPendingPhotos, pendingPhotos, type PendingState } from '../pending-photos';
import { PHOTO_FILE_TYPES, pickFiles, pickGalleryPhotos } from '../platform-device';
import filterIcon from '../icons/filter.svg?raw';
import folderIcon from '../icons/folder.svg?raw';
import imageIcon from '@icons/image.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// The Galerie tab, from the boards "Galerie", "Galerie, aucune photo", "Galerie, résolutions en cours" and "Galerie,
// ajouter une photo": the photos as tiles with their picture and the first object of the photo, before them the
// imported photos that are not on the sky yet with where they stand, and the plus that opens the sheet to add photos.
// Choosing files, or pictures of the phone's gallery, opens the import ("Importer des photos").
const router = useRouter();
const { showError } = useErrorToast();

// null until the photos are read; the empty state shows only once the backend has answered with none.
const photos = ref<Photo[] | null>(null);
const adding = ref(false);

const tiles = computed(() =>
  (photos.value ?? []).map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    object: photo.dsoIds?.[0] ?? '',
    picture: photoFileUrl(photo.thumbFilename ?? photo.filename),
  })),
);

// A picture that cannot be read leaves the tile with the photo's name.
const brokenPictures = ref(new Set<string>());

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
const isEmpty = computed(
  () => photos.value !== null && photos.value.length === 0 && waiting.value.length === 0,
);

async function load() {
  try {
    await loadPendingPhotos();
  } catch (error) {
    reportError('GalleryPage.loadPendingPhotos', error);
  }
  try {
    photos.value = await getPhotos();
  } catch (error) {
    reportError('GalleryPage.getPhotos', error);
  }
}
onMounted(load);
onIonViewWillEnter(load);

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
        :placeholder="t('photos.searchPlaceholder')"
        :label="t('mobile.gallery.searchLabel')"
      />
      <PhoneIconButton :label="t('targets.moreFilters')"
        ><AppIcon :svg="filterIcon"
      /></PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill">
        <PhoneEmptyState
          v-if="isEmpty"
          :text="t('mobile.gallery.empty')"
          :button-label="t('batch.modalTitle')"
          :button-icon="plusIcon"
          @action="adding = true"
        />
        <div v-else class="mob-photo-grid">
          <!-- Choosing how to place a waiting photo is not built yet: the tile shows and does nothing. -->
          <div v-for="tile in waiting" :key="tile.id" class="mob-photo">
            <button
              type="button"
              class="mob-photo-tile mob-photo-tile--state m-secondary"
              :aria-label="`${tile.name} : ${tile.state}`"
            >
              <span class="mob-photo-name">{{ tile.name }}</span>
              <span
                class="mob-photo-state m-caption"
                :class="{ 'mob-photo-state--busy': tile.busy }"
                ><PhoneBusy v-if="tile.busy" :label="tile.state" /><template v-else>{{
                  tile.state
                }}</template></span
              >
            </button>
            <span class="mob-photo-id m-mono" />
          </div>
          <!-- A photo's own screen is not built yet: the tile shows and does nothing. -->
          <div v-for="tile in tiles" :key="tile.id" class="mob-photo">
            <button
              type="button"
              class="mob-photo-tile m-secondary"
              :class="{ 'mob-photo-tile--picture': !brokenPictures.has(tile.id) }"
              :aria-label="tile.name"
            >
              <span v-if="brokenPictures.has(tile.id)" class="mob-photo-name">{{ tile.name }}</span>
              <img
                v-else
                class="mob-photo-picture"
                :src="tile.picture"
                alt=""
                loading="lazy"
                @error="brokenPictures.add(tile.id)"
              />
            </button>
            <span class="mob-photo-id m-mono">{{ tile.object }}</span>
          </div>
        </div>
      </div>
      <PhoneFab
        v-if="photos !== null && !isEmpty"
        in-tab
        :label="t('batch.modalTitle')"
        @click="adding = true"
      />
    </IonContent>
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
