<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { sortGalleryPhotos } from '@myastrosky/core/gallery-filter';
import { FULL_BACKUP_OPTIONS } from '@myastrosky/core/backup-selection';
import { buildDeleteSummaryLines } from '@myastrosky/core/delete-utils';
import { replaceUserOverrides } from '@myastrosky/core/catalog/dso-registry';
import type { Photo } from '@myastrosky/core/types';
import {
  deleteAllCustomGear,
  deleteAllDsoOverrides,
  deleteAllGearSetupsAPI,
  deleteAllPhotoMetadata,
  deleteBulkPhotos,
  exportData,
  getDsoOverrides,
  getPhotos,
} from '@myastrosky/app-state/api';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { gallerySort } from '../gallery-display';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import caretIcon from '../icons/chevron-down.svg?raw';

// The board "Réglages, supprimer des données": the desktop's delete window. The Photos field opens the sheet "Réglages,
// photos à supprimer"; Supprimer asks first ("Réglages, confirmer la suppression"), then goes back to Réglages.
const router = useRouter();
const { confirm } = useConfirm();
const { showError, showNotice } = useErrorToast();

const flags = reactive({
  photoMetadata: false,
  dsoOverrides: false,
  customGear: false,
  gearSetups: false,
});
/** The skies other people shared, kept as visits: never deleted unless ticked. */
const sharedSkies = useSharedSkiesStore();
const deleteVisits = ref(false);
const ROWS: { flag: keyof typeof flags; label: string }[] = [
  { flag: 'photoMetadata', label: 'settings.deletePhotoMeta' },
  { flag: 'dsoOverrides', label: 'settings.deleteDsoOverrides' },
  { flag: 'customGear', label: 'settings.deleteCustomGear' },
  { flag: 'gearSetups', label: 'settings.deleteGearSetups' },
];

// No photo is ticked at first; the photos list in the gallery's order.
const photos = ref<Photo[]>([]);
const sortedPhotos = computed(() => sortGalleryPhotos(photos.value, gallerySort.value));
const selected = ref(new Set<string>());
const photosOpen = ref(false);
const backingUp = ref(false);
const deleting = ref(false);

// Read each time the page is shown: photos may have been added or deleted since it was last open.
async function loadPhotos() {
  try {
    const list = await getPhotos();
    const ids = new Set(list.map((p) => p.id));
    photos.value = list;
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
  } catch (error) {
    void showError(error);
  }
}
onMounted(loadPhotos);
onIonViewWillEnter(loadPhotos);
onMounted(() => void sharedSkies.load());

const allPhotosTicked = computed(
  () => photos.value.length > 0 && photos.value.every((p) => selected.value.has(p.id)),
);
const somePhotosTicked = computed(() => selected.value.size > 0 && !allPhotosTicked.value);
const canDelete = computed(
  () => selected.value.size > 0 || deleteVisits.value || Object.values(flags).some(Boolean),
);

function tickPhoto(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}
function tickAllPhotos(on: boolean) {
  selected.value = new Set(on ? photos.value.map((p) => p.id) : []);
}

// The backup holds everything this page can delete: every photo, the setups, the gear and the DSO changes.
async function backup() {
  if (backingUp.value) return;
  backingUp.value = true;
  try {
    await exportData(
      FULL_BACKUP_OPTIONS,
      sortedPhotos.value.map((p) => p.id),
    );
  } catch (error) {
    void showError(error);
  } finally {
    backingUp.value = false;
  }
}

async function remove() {
  if (deleting.value || !canDelete.value) return;
  const photoIds = sortedPhotos.value.filter((p) => selected.value.has(p.id)).map((p) => p.id);
  const lines = buildDeleteSummaryLines(
    {
      ...flags,
      sharedSkies: deleteVisits.value ? sharedSkies.skies.length : 0,
      photoIds,
      totalPhotos: photos.value.length,
    },
    t,
  );
  const yes = await confirm({
    title: t('settings.deleteConfirmTitle'),
    message: lines.map((line) => `• ${line}`).join('\n'),
    warning: t('settings.deleteConfirmPermanent'),
    confirmLabel: t('settings.deleteAction'),
    destructive: true,
  });
  if (!yes) return;
  deleting.value = true;
  try {
    // In the desktop's order: the photos, then the DSO changes (shown again at once), the gear, the setups.
    if (flags.photoMetadata) await deleteAllPhotoMetadata();
    else if (photoIds.length) await deleteBulkPhotos(photoIds);
    if (flags.dsoOverrides) {
      await deleteAllDsoOverrides();
      try {
        replaceUserOverrides(await getDsoOverrides());
      } catch {
        /* the overrides are read again at the next start */
      }
    }
    if (flags.customGear) await deleteAllCustomGear();
    if (flags.gearSetups) await deleteAllGearSetupsAPI();
    if (deleteVisits.value) {
      for (const sky of [...sharedSkies.skies]) await sharedSkies.remove(sky.id);
    }
    void showNotice(t('settings.deleteSuccess'));
    router.back();
  } catch (error) {
    void showError(error);
    await loadPhotos();
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('settings.deleteModalTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhoneHelper class="mob-status--warn">{{ t('settings.deleteBackupWarning') }}</PhoneHelper>
        <div class="mob-form-row">
          <PhoneButton block :busy="backingUp" @click="backup">{{
            t('settings.importBackupBtn')
          }}</PhoneButton>
        </div>
        <div class="mob-section-gap-sm"></div>
        <IonList class="mob-list" lines="none">
          <PhoneCheckRow
            v-for="row in ROWS"
            :key="row.flag"
            v-model="flags[row.flag]"
            :title="t(row.label)"
          />
          <!-- Board "Réglages, supprimer des données": once a sky has been visited. -->
          <PhoneCheckRow
            v-if="sharedSkies.skies.length > 0"
            v-model="deleteVisits"
            :title="t('settings.deleteSharedSkies')"
          />
        </IonList>
        <div class="mob-section-gap-sm"></div>
        <div class="mob-form-row mob-form-row--spaced">
          <PhoneButton
            variant="field"
            text-style="body"
            block
            :disabled="!photos.length"
            :aria-label="
              t('mobile.format.labelValue', {
                label: t('settings.deletePhotosSection'),
                value: `${selected.size} / ${photos.length}`,
              })
            "
            @click="photosOpen = true"
          >
            <span class="mob-btn-key">{{ t('settings.deletePhotosSection') }}</span>
            <span class="mob-btn-value mob-btn-value--swatch"
              >{{ selected.size }} / {{ photos.length }}</span
            >
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton
            variant="dangerFill"
            size="lg"
            block
            :busy="deleting"
            :disabled="!deleting && !canDelete"
            @click="remove"
          >
            {{ t('settings.deleteAction') }}
          </PhoneButton>
        </div>
      </div>
    </IonContent>
    <PhoneSheet v-model:open="photosOpen" :title="t('settings.deletePhotosSection')">
      <IonList class="mob-list" lines="none">
        <PhoneCheckRow
          :model-value="allPhotosTicked"
          :indeterminate="somePhotosTicked"
          :title="t('settings.deleteSelectAll')"
          @update:model-value="tickAllPhotos($event)"
        />
        <PhoneCheckRow
          v-for="photo in sortedPhotos"
          :key="photo.id"
          :model-value="selected.has(photo.id)"
          :title="photo.originalName"
          :subs="[photo.fileSize ? formatBytes(photo.fileSize) : '—']"
          @update:model-value="tickPhoto(photo.id, $event)"
        />
      </IonList>
    </PhoneSheet>
  </IonPage>
</template>
