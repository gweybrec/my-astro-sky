<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { Photo } from '@myastrosky/core/types';
import { findPhotoWithFileName } from '@myastrosky/core/photo-name-match';
import { getPhotos } from '@myastrosky/app-state/api';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import {
  discardImport,
  importAll,
  importBusy,
  importRows,
  importableCount,
  type ImportRow,
} from '../composables/usePhotoImport';
import { pendingStateText, pendingStatus } from '../pending-display';
import { solvedPhotoCount } from '../pending-solve';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import imageIcon from '@icons/image.svg?raw';

// The page "Importer des photos": one row per chosen file with where it stands; a tap opens its page "Photo à ajouter"
// (placement methods and metadata), which comes back here. The list stays as it is while those pages are open.
// Importer stores the placed photos with their metadata and sends the others to the gallery as waiting photos, with
// theirs. Leaving with photos in the list asks first (board "Importer, abandonner l'import"): they are not added.
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();
const importing = ref(false);
let leaving = false;

// A file named like one of the user's photos says so under its state (board "Importer, nom déjà utilisé"): it may
// be another photo of the same object, so it is only a note. The list of photos is read again when files come in.
const storedPhotos = ref<Photo[]>([]);
watch(
  () => importRows.value.length,
  () =>
    void getPhotos()
      .then((photos) => (storedPhotos.value = photos))
      .catch((error) => reportError('ImportPhotosPage.getPhotos', error)),
  { immediate: true },
);
const noteOf = (row: ImportRow) =>
  row.kind === 'pending' && findPhotoWithFileName(row.photo.name, storedPhotos.value)
    ? t('batch.nameAlreadyUsed')
    : undefined;

const title = computed(() =>
  importRows.value.length === 1
    ? t('mobile.gallery.importOne')
    : t('mobile.gallery.importMany', { n: importRows.value.length }),
);

function open(row: ImportRow) {
  if (row.kind === 'pending') void router.push(`/gallery/pending/${row.photo.id}`);
}

const subOf = (row: ImportRow) =>
  row.kind === 'pending'
    ? pendingStateText(row.photo)
    : row.file.status === 'converting'
      ? t('batch.statusConverting')
      : row.file.error || t('batch.statusFailed');

const statusOf = (row: ImportRow) =>
  row.kind === 'pending'
    ? pendingStatus(row.photo)
    : row.file.status === 'converting'
      ? 'busy'
      : 'danger';

function goBack() {
  leaving = true;
  if (window.history.state?.back) router.back();
  else void router.replace('/tabs/gallery');
}

/** Leaving with photos in the list gives the import up, after a question. */
async function mayLeave(): Promise<boolean> {
  const n = importRows.value.length;
  if (leaving || n === 0) return true;
  const ok = await confirm({
    title: t('mobile.gallery.leaveTitle'),
    message:
      n === 1
        ? t('mobile.gallery.leaveMessageOne', { button: t('mobile.gallery.import') })
        : t('mobile.gallery.leaveMessageMany', { n, button: t('mobile.gallery.import') }),
    confirmLabel: t('mobile.gallery.leaveConfirm'),
    destructive: true,
  });
  if (!ok) return false;
  try {
    await discardImport();
  } catch (error) {
    void showError(error);
    return false;
  }
  return true;
}

async function leave() {
  if (await mayLeave()) goBack();
}
useBackClose(
  () => !leaving && importRows.value.length > 0,
  () => void leave(),
);

async function run() {
  importing.value = true;
  try {
    const { stored, errors } = await importAll();
    if (stored.length) solvedPhotoCount.value += 1;
    if (errors.length) {
      void showError(
        errors
          .map((e) => t('mobile.format.labelValue', { label: e.name, value: e.message }))
          .join('\n'),
      );
    }
    if (importRows.value.length === 0) {
      leaving = true;
      await router.replace('/tabs/gallery');
    }
  } catch (error) {
    void showError(error);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/gallery" :before="mayLeave" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-pad">
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-for="row in importRows"
            :key="row.key"
            :thumb="imageIcon"
            :title="row.kind === 'pending' ? row.photo.name : row.file.name"
            :subs="[subOf(row)]"
            :status="statusOf(row)"
            :note="noteOf(row)"
            :warning="
              row.kind === 'pending' && row.photo.noSolution
                ? t('mobile.gallery.noSolutionLoaded')
                : undefined
            "
            :button="row.kind === 'pending'"
            :chevron="row.kind === 'pending'"
            @click="open(row)"
          />
        </IonList>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton
        variant="confirm"
        size="lg"
        block
        :disabled="importableCount === 0 || importBusy || importing"
        @click="run"
        >{{ t('mobile.gallery.import') }}</PhoneButton
      >
    </PhoneFooter>
  </IonPage>
</template>
