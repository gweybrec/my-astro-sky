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
import type { Photo } from '@myastrosky/core/types';
import {
  deletePhotoAPI,
  getGearSetups,
  getPhotos,
  loadServerSettings,
  type GearSetupData,
} from '@myastrosky/app-state/api';
import { isPlacedPhoto } from '@myastrosky/core/photo-placement';
import { noSolutionMessage } from '@myastrosky/app-state/wcs-load-flow';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { catalogsReady } from '../catalogs';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { useWcsLoad, type WcsLoaded } from '../composables/useWcsLoad';
import {
  openStoredPhoto,
  pendingDraft,
  pendingPhotoFile,
  pendingPhotos,
  pendingPlacement,
  removePendingPhoto,
  setPendingDraft,
  setPendingFitsHeaders,
  storePendingPhoto,
} from '../pending-photos';
import {
  fetchPendingResult,
  shownPendingId,
  solvedPhotoCount,
  solvePendingOnline,
} from '../pending-solve';
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
import SolveHint from './gallery/SolveHint.vue';
import imageIcon from '@icons/image.svg?raw';
import trashIcon from '@icons/trash.svg?raw';
import targetIcon from '@icons/target.svg?raw';
import cloudIcon from '@icons/cloud.svg?raw';
import smartphoneIcon from '../icons/smartphone.svg?raw';

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
    // A gallery photo stored "À résoudre": its record is made from the store the first time its page opens.
    let stored: Photo[] | null = null;
    if (!pendingPhotos.value.some((p) => p.id === id)) {
      stored = await getPhotos();
      const found = stored.find((p) => p.id === id && !isPlacedPhoto(p));
      if (found) await openStoredPhoto(found);
    }
    const saved = await pendingDraft(id);
    if (!saved) {
      leaving = true;
      void router.replace('/tabs/gallery');
      return;
    }
    original.value = copy(saved);
    Object.assign(draft, copy(unsavedDrafts.get(id) ?? saved));
    const photos = stored ?? (await getPhotos());
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

/** astrometry.net goes on with a solve of this photo ("En cours"): its result is fetched, nothing is sent again. */
const unfinished = computed(
  () => photo.value?.state === 'unfinished' && !!photo.value.submissionId,
);

function solveOnline() {
  // A greyed-out row still receives the tap.
  if (unavailableReason() || solving.value || unfinished.value) return;
  void solvePendingOnline(id);
}

function fetchResult() {
  if (unavailableReason() || solving.value) return;
  void fetchPendingResult(id);
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
    // A gallery photo is saved again now (and placed, when it is); in the import list Importer stores it.
    if (current.storedId) {
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
    if (current.storedId) await deletePhotoAPI(current.storedId);
    await removePendingPhoto(id);
    unsavedDrafts.delete(id);
    solvedPhotoCount.value += 1;
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
        <SolveHint :photo-id="id" :disabled="solving" />

        <h2 class="pending-group m-secondary">
          <AppIcon :svg="smartphoneIcon" />{{ t('mobile.gallery.groupPhone') }}
        </h2>
        <IonList class="mob-list" lines="none">
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

        <h2 class="pending-group m-secondary">
          <AppIcon :svg="cloudIcon" />{{ t('batch.groupOnline') }}
        </h2>
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-if="unfinished"
            button
            wrap
            :disabled="!online || !keySet || solving"
            :title="t('batch.methodFetch')"
            :subs="[unavailableReason() ?? t('batch.methodFetchSub')]"
            data-test="fetch-result"
            @click="fetchResult"
          />
          <PhoneRow
            button
            wrap
            :disabled="!online || !keySet || solving || unfinished"
            :title="t('mobile.gallery.solveOnline')"
            :subs="[
              unavailableReason() ??
                (unfinished ? t('batch.onlineRunning') : t('batch.methodOnlineSub')),
            ]"
            data-test="solve-online"
            @click="solveOnline"
          >
            <template #title-end>
              <span
                class="phone-hint-mark"
                role="img"
                :aria-label="t('batch.usesHint')"
                data-test="hint-mark"
                ><AppIcon :svg="targetIcon"
              /></span>
            </template>
          </PhoneRow>
          <PhoneRow
            button
            wrap
            :disabled="!online || !keySet || solving"
            :title="t('batch.methodReuse')"
            :subs="[unavailableReason() ?? t('mobile.gallery.reuseSolutionSub')]"
            @click="reuse"
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

<style scoped>
/* The heading of a group of placement methods: where they run (the phone, online), with its icon. */
.pending-group {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-6) var(--mobile-gutter-end) var(--space-2) var(--mobile-gutter);
  color: var(--text-secondary);
  font-weight: normal;
}
.pending-group :deep(svg) {
  flex: none;
  width: var(--space-8);
  height: var(--space-8);
}
</style>
