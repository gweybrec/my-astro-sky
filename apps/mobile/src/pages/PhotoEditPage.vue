<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { isPhotoSolved, mergeIdentifiedPois } from '@myastrosky/core/photo-identify';
import {
  draftFromPhoto,
  draftToMetadata,
  applyWcsChanges,
  wcsDraftChanges,
  isDraftDirty,
  type PhotoMetadataDraft,
} from '@myastrosky/core/photo-metadata-draft';
import type { Photo } from '@myastrosky/core/types';
import {
  getGearSetups,
  getPhotos,
  setPhotoFitsHeaders,
  updatePhotoMetadata,
  type GearSetupData,
} from '@myastrosky/app-state/api';
import { noSolutionMessage } from '@myastrosky/app-state/wcs-load-flow';
import type { FitsCard } from '@myastrosky/core/fits-header';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { pendingWcs, useWcsLoad, type WcsLoaded } from '../composables/useWcsLoad';
import { receivePois } from '../identify-session';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhotoMetadataForm from './gallery/PhotoMetadataForm.vue';
import { useRowFilterAdd } from '../composables/useRowFilterAdd';
import { integrationRowHasData, recentIntegrationFilters } from '@myastrosky/core/integration-rows';

// The board "Photo, modifier les infos": the form of a photo's metadata (`PhotoMetadataForm`), with what the desktop's
// editor does (`MetadataEditorPanel.vue`): nothing is saved before Enregistrer, and leaving with changes asks first. The points of
// interest added by hand or found by an identification join the form (`receivePois`), as the desktop's PoiEditor.
// "Charger un fichier WCS" fills only the empty fields from a solved file's header, unsaved as the rest; a file read
// from the photo's sheet (`pendingWcs`) is filled in the same way when the form opens.
// The toasts of the form sit above its footer (board "Photo, fichier non résolu").
const FOOTER_ID = 'photo-edit-footer';
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const { showError, showNotice, showWarning } = useErrorToast({ above: FOOTER_ID });
const { loading: wcsLoading, read: readWcs } = useWcsLoad({ above: FOOTER_ID });
const categoriesStore = usePoiCategoriesStore();

const photo = ref<Photo | null>(null);
const original = ref<PhotoMetadataDraft | null>(null);
const draft = reactive<PhotoMetadataDraft>({
  displayName: '',
  dsoIds: [],
  labels: [],
  pointsOfInterest: [],
  integrations: [],
  observationDate: '',
  captureDetails: {},
  gearSetupId: null,
  notes: '',
});
const knownLabels = ref<string[]>([]);
const usedFilters = ref<string[]>([]);
const addRowFilter = useRowFilterAdd(() => draft.integrations);
const setups = ref<GearSetupData[]>([]);
const saving = ref(false);
/** The page is being left on purpose (saved, or the changes given up): nothing asks again. */
let leaving = false;

const fallback = computed(() => `/gallery/photo/${String(route.params.id)}`);

onMounted(async () => {
  try {
    const photos = await getPhotos();
    const found = photos.find((p) => p.id === route.params.id);
    if (!found) {
      void router.replace('/tabs/gallery');
      return;
    }
    Object.assign(draft, draftFromPhoto(found));
    original.value = draftFromPhoto(found);
    photo.value = found;
    if (pendingWcs.value?.photoId === found.id) {
      applyWcs(pendingWcs.value);
      pendingWcs.value = null;
    }
    knownLabels.value = [...new Set(photos.flatMap((p) => p.labels))];
    usedFilters.value = recentIntegrationFilters(photos, Infinity);
    setups.value = await getGearSetups();
    void categoriesStore.ensureLoaded();
    // The objects' search needs the catalogues; until they are read it finds nothing.
    catalogsReady().catch(() => undefined);
  } catch (error) {
    void showError(error);
  }
});

// The header cards of the file read in this form, saved with the photo on Enregistrer: unsaved, like the fields.
const loadedCards = ref<FitsCard[] | null>(null);
const dirty = computed(
  () =>
    original.value !== null && (isDraftDirty(draft, original.value) || loadedCards.value !== null),
);

// ── WCS file ──────────────────────────────────────────────────────────────────────────────────────

function applyWcs(loaded: WcsLoaded) {
  const { fills } = wcsDraftChanges(draft, loaded.result, loaded.suggestedSetup);
  Object.assign(draft, applyWcsChanges(draft, fills));
  if (loaded.result.fitsHeaders?.length) loadedCards.value = loaded.result.fitsHeaders;
  // A file without a plate solution: its capture data was taken, the photo is not placed by it (board "Photo,
  // fichier non résolu").
  if (!loaded.solved) void showWarning(noSolutionMessage(loaded.filename));
  else
    void showNotice(
      fills.length > 0 ? t('gallery.loadFromWcsSuccess') : t('gallery.loadFromWcsEmpty'),
    );
}

async function loadWcs() {
  if (!photo.value) return;
  const loaded = await readWcs(photo.value, {
    dsoIds: draft.dsoIds,
    gearSetupId: draft.gearSetupId,
  });
  if (loaded) applyWcs(loaded);
}

const isSolved = computed(() => !!photo.value && isPhotoSolved(photo.value));
const stopReceiving = receivePois(String(route.params.id), (pois) => {
  const { merged, fresh } = mergeIdentifiedPois(draft.pointsOfInterest, pois);
  draft.pointsOfInterest = merged;
  return fresh;
});
onBeforeUnmount(stopReceiving);
const openPoiPage = (path: string) => {
  if (photo.value) void router.push(`/gallery/photo/${photo.value.id}/${path}`);
};

// ── Leaving and saving ────────────────────────────────────────────────────────────────────────────

function goBack() {
  leaving = true;
  if (window.history.state?.back) router.back();
  else void router.replace(fallback.value);
}

/** As the desktop: leaving with changes that are not saved asks first. */
async function mayLeave(): Promise<boolean> {
  if (leaving || !dirty.value) return true;
  return confirm({
    title: t('gallery.metadataTitle'),
    message: t('gallery.unsavedChanges'),
    confirmLabel: t('gallery.closeWithoutSaving'),
    destructive: true,
  });
}

async function cancel() {
  if (await mayLeave()) goBack();
}
useBackClose(
  () => !leaving && dirty.value,
  () => void cancel(),
);

async function save() {
  if (!photo.value || saving.value) return;
  // An exposure row may leave any field empty, but not all three.
  if (draft.integrations.some((row) => !integrationRowHasData(row))) {
    void showError(new Error(t('errors.integrationRowIncomplete')));
    return;
  }
  saving.value = true;
  try {
    await updatePhotoMetadata(photo.value.id, draftToMetadata(draft, photo.value.originalName));
    if (loadedCards.value) await setPhotoFitsHeaders(photo.value.id, loadedCards.value);
    goBack();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="fallback" :before="mayLeave" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('gallery.metadataTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="photo" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhotoMetadataForm
          v-model:draft="draft"
          :known-labels="knownLabels"
          :used-filters="usedFilters"
          :setups="setups"
          :solved="isSolved"
          :wcs-loading="wcsLoading"
          :footer-id="FOOTER_ID"
          @poi="openPoiPage"
          @add-filter="addRowFilter"
          @load-wcs="loadWcs"
        />
      </div>
    </IonContent>
    <PhoneFooter :id="FOOTER_ID">
      <PhoneButton size="lg" @click="cancel">{{ t('gallery.cancelEdit') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!photo || saving" @click="save">
        {{ t('gallery.saveMetadata') }}
      </PhoneButton>
    </PhoneFooter>
  </IonPage>
</template>
