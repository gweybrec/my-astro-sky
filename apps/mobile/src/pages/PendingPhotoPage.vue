<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import {
  applyWcsChanges,
  isDraftDirty,
  wcsDraftChanges,
  type PhotoMetadataDraft,
} from '@myastrosky/core/photo-metadata-draft';
import type { FitsCard } from '@myastrosky/core/fits-header';
import {
  getGearSetups,
  getPhotos,
  loadServerSettings,
  type GearSetupData,
} from '@myastrosky/app-state/api';
import { noSolutionMessage } from '@myastrosky/app-state/wcs-load-flow';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { useWcsLoad, type WcsLoaded } from '../composables/useWcsLoad';
import {
  pendingDraft,
  pendingPhotoFile,
  pendingPhotos,
  pendingPlacement,
  removePendingPhoto,
  setPendingDraft,
  setPendingFitsHeaders,
  storePendingPhoto,
} from '../pending-photos';
import { shownPendingId, solvedPhotoCount, solvePendingOnline } from '../pending-solve';
import { pendingStateText, pendingStatus, unsavedDrafts } from '../pending-display';
import { skyPlacement } from '../sky-modes';
import { endIdentify } from '../star-identify-session';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhotoMetadataForm from './gallery/PhotoMetadataForm.vue';
import imageIcon from '@icons/image.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The boards "Photo à ajouter" and "…, placée": a photo not stored yet, from the import list or the gallery's waiting
// photos. Its file and where it stands, the placement methods (as the desktop's cards of "Ajouter des photos"), and
// its metadata (`PhotoMetadataForm`). A method comes back here with the photo placed, not stored. Enregistrer keeps the
// metadata; from the gallery it also stores a placed photo. Leaving with changes that are not saved asks first.
const FOOTER_ID = 'pending-photo-footer';
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const { showError, showNotice, showWarning } = useErrorToast({ above: FOOTER_ID });
const { loading: wcsLoading, read: readWcs } = useWcsLoad({ above: FOOTER_ID });
const categoriesStore = usePoiCategoriesStore();

const id = String(route.params.id);
const photo = computed(() => pendingPhotos.value.find((p) => p.id === id) ?? null);
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
const setups = ref<GearSetupData[]>([]);
const saving = ref(false);
/** The page is being left on purpose (saved, given up, deleted): nothing asks again. */
let leaving = false;

const copy = (d: PhotoMetadataDraft): PhotoMetadataDraft =>
  JSON.parse(JSON.stringify(d)) as PhotoMetadataDraft;

const fallback = computed(() => (photo.value?.inImport ? '/gallery/import' : '/tabs/gallery'));

// What solving online and reusing a solution need: a connection and the astrometry.net key.
const online = ref(true);
const keySet = ref(true);
const unavailableReason = () =>
  !online.value ? t('mobile.gallery.offline') : !keySet.value ? t('modal.solverNoApiKey') : null;

onMounted(async () => {
  shownPendingId.value = id;
  online.value = navigator.onLine;
  try {
    const saved = await pendingDraft(id);
    if (!saved) {
      leaving = true;
      void router.replace('/tabs/gallery');
      return;
    }
    original.value = copy(saved);
    Object.assign(draft, copy(unsavedDrafts.get(id) ?? saved));
    const photos = await getPhotos();
    knownLabels.value = [...new Set(photos.flatMap((p) => p.labels))];
    setups.value = await getGearSetups();
    void categoriesStore.ensureLoaded();
    // The objects' search needs the catalogues; until they are read it finds nothing.
    catalogsReady().catch(() => undefined);
  } catch (error) {
    void showError(error);
  }
  try {
    keySet.value = (await loadServerSettings()).apiKeySet;
  } catch (error) {
    reportError('PendingPhotoPage.loadServerSettings', error);
  }
});
onBeforeUnmount(() => {
  if (shownPendingId.value === id) shownPendingId.value = null;
});

// The header cards of a file read on this page, kept with the metadata on Enregistrer.
const loadedCards = ref<FitsCard[] | null>(null);
const dirty = computed(
  () =>
    original.value !== null && (isDraftDirty(draft, original.value) || loadedCards.value !== null),
);

// ── Placement methods ─────────────────────────────────────────────────────────────────────────────

const solving = computed(() => photo.value?.state === 'solving');

/** The page is opened again after a method: what was typed is kept for it. */
const keepTyped = () => unsavedDrafts.set(id, copy(draft));

function solveOnline() {
  // A greyed-out row still receives the tap.
  if (unavailableReason() || solving.value) return;
  void solvePendingOnline(id);
}

function reuse() {
  if (unavailableReason() || solving.value) return;
  keepTyped();
  void router.push(`/gallery/reuse/${id}`);
}

// Identifying stars starts with no point, even when an earlier identification of this photo was left.
function identify() {
  if (solving.value) return;
  keepTyped();
  endIdentify(id);
  void router.push(`/gallery/identify/${id}`);
}

// Placing by hand is done on the sky map; Valider there opens this page again.
function placeByHand() {
  if (solving.value) return;
  keepTyped();
  skyPlacement.value = { pendingId: id };
  void router.push('/tabs/sky');
}

// ── WCS file ──────────────────────────────────────────────────────────────────────────────────────
// As on "Modifier les infos": a solved or raw file fills only the empty fields, unsaved as the rest.

function applyWcs(loaded: WcsLoaded) {
  const { fills } = wcsDraftChanges(draft, loaded.result, loaded.suggestedSetup);
  Object.assign(draft, applyWcsChanges(draft, fills));
  if (loaded.result.fitsHeaders?.length) loadedCards.value = loaded.result.fitsHeaders;
  if (!loaded.solved) void showWarning(noSolutionMessage(loaded.filename));
  else
    void showNotice(
      fills.length > 0 ? t('gallery.loadFromWcsSuccess') : t('gallery.loadFromWcsEmpty'),
    );
}

/** The size of the kept picture, which the file read is compared with. */
async function pictureSize(): Promise<{ width: number; height: number }> {
  const file = await pendingPhotoFile(id);
  if (!file) return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

async function loadWcs() {
  const placement = await pendingPlacement(id);
  const loaded = await readWcs(
    {
      ...(await pictureSize()),
      dsoIds: draft.dsoIds,
      correspondences: placement?.correspondences ?? [],
      manualPlacement: placement?.manualPlacement,
      gearSetupId: draft.gearSetupId,
    },
    { dsoIds: draft.dsoIds, gearSetupId: draft.gearSetupId },
  );
  if (loaded) applyWcs(loaded);
}

// ── Leaving, saving, deleting ─────────────────────────────────────────────────────────────────────

function goBack() {
  leaving = true;
  if (window.history.state?.back) router.back();
  else void router.replace(fallback.value);
}

async function mayLeave(): Promise<boolean> {
  if (leaving || !dirty.value) {
    unsavedDrafts.delete(id);
    return true;
  }
  const ok = await confirm({
    title: t('mobile.gallery.photoToAdd'),
    message: t('gallery.unsavedChanges'),
    confirmLabel: t('gallery.closeWithoutSaving'),
    destructive: true,
  });
  if (ok) unsavedDrafts.delete(id);
  return ok;
}

async function cancel() {
  if (await mayLeave()) goBack();
}
useBackClose(
  () => !leaving && dirty.value,
  () => void cancel(),
);

async function save() {
  const current = photo.value;
  if (!current || saving.value) return;
  saving.value = true;
  try {
    await setPendingDraft(id, draft);
    if (loadedCards.value) await setPendingFitsHeaders(id, loadedCards.value);
    unsavedDrafts.delete(id);
    // From the gallery, a placed photo is stored now; in the import list Importer stores it.
    if (!current.inImport && current.state === 'placed') {
      await storePendingPhoto(id);
      solvedPhotoCount.value += 1;
    }
    goBack();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}

// A photo not stored yet is deleted after the same question as a stored one; it was only kept on the phone.
async function deletePhoto() {
  const current = photo.value;
  if (!current) return;
  const ok = await confirm({
    title: t('photos.deleteConfirmTitle'),
    message: t('photos.deleteConfirmMessage', { name: current.name }),
    confirmLabel: t('photos.deleteConfirmAction'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await removePendingPhoto(id);
    unsavedDrafts.delete(id);
    goBack();
  } catch (error) {
    await showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton :fallback="fallback" :before="mayLeave" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.gallery.photoToAdd') }}
      </h1>
      <PhoneIconButton danger :label="t('photos.deleteThisPhoto')" @click="deletePhoto">
        <AppIcon :svg="trashIcon" />
      </PhoneIconButton>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div v-if="photo" class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <IonList class="mob-list" lines="none">
          <PhoneRow
            :thumb="imageIcon"
            :title="photo.name"
            :subs="[pendingStateText(photo)]"
            :status="pendingStatus(photo)"
            :warning="photo.noSolution ? t('mobile.gallery.noSolutionLoaded') : undefined"
          />
        </IonList>

        <PhoneSectionHeader>{{ t('mobile.gallery.chooseMethod') }}</PhoneSectionHeader>
        <IonList class="mob-list" lines="none">
          <PhoneRow
            button
            wrap
            :disabled="!online || !keySet || solving"
            :title="t('mobile.gallery.solveOnline')"
            :subs="[unavailableReason() ?? t('mobile.gallery.solveOnlineSub')]"
            @click="solveOnline"
          />
          <PhoneRow
            button
            wrap
            :disabled="!online || !keySet || solving"
            :title="t('mobile.gallery.reuseSolution')"
            :subs="[unavailableReason() ?? t('mobile.gallery.reuseSolutionSub')]"
            @click="reuse"
          />
          <PhoneRow
            button
            wrap
            :disabled="solving"
            :title="t('mobile.gallery.identifyStars')"
            :subs="[t('mobile.gallery.identifyStarsSub')]"
            @click="identify"
          />
          <PhoneRow
            button
            wrap
            :disabled="solving"
            :title="t('mobile.gallery.placeByHand')"
            :subs="[t('mobile.gallery.placeByHandSub')]"
            @click="placeByHand"
          />
        </IonList>

        <PhotoMetadataForm
          v-if="original"
          v-model:draft="draft"
          :known-labels="knownLabels"
          :setups="setups"
          :solved="false"
          :wcs-loading="wcsLoading"
          :footer-id="FOOTER_ID"
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
