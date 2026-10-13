<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewDidLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useErrorToast } from '../composables/useErrorToast';
import {
  clearImport,
  importAll,
  importBusy,
  importItems,
  importableCount,
  solveImportOnline,
  type ImportItem,
} from '../composables/usePhotoImport';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PlacementMethodSheet from './gallery/PlacementMethodSheet.vue';
import imageIcon from '@icons/image.svg?raw';

// The page "Importer des photos": one row per chosen file with where it stands, and the button that imports them all.
// A solved TIFF, FITS or XISF says where the photo is on the sky, so it is stored placed; the other photos are kept
// waiting and shown in the gallery as "À placer". A tap on a photo to place, or on one whose solve failed, asks how to
// place it (boards "Importer, méthode de placement" and "Importer, échec de la résolution"); solved online from here,
// the row shows "Résolution" and leaves the list once the photo is placed.
const router = useRouter();
const { showError } = useErrorToast();
const importing = ref(false);
/** The photo whose placement method is being chosen. */
const placing = ref<ImportItem | null>(null);
const methodOpen = ref(false);

const canChoose = (item: ImportItem) => item.status === 'toPlace' || item.status === 'solveFailed';

function chooseMethod(item: ImportItem) {
  if (!canChoose(item)) return;
  placing.value = item;
  methodOpen.value = true;
}

function solveOnline() {
  if (placing.value) void solveImportOnline(placing.value);
}

const title = computed(() =>
  importItems.value.length === 1
    ? t('mobile.gallery.importOne')
    : t('mobile.gallery.importMany', { n: importItems.value.length }),
);

const stateOf = (item: ImportItem) => {
  switch (item.status) {
    case 'converting':
      return t('batch.statusConverting');
    case 'solved':
      return t('mobile.gallery.alreadySolved');
    case 'importing':
      return t('batch.statusPlacing');
    case 'failed':
      return item.error || t('batch.statusFailed');
    case 'solving':
      return t('mobile.gallery.solving');
    case 'solveFailed':
      return t('batch.statusFailed');
    default:
      return t('mobile.gallery.toPlace');
  }
};

const BUSY = new Set(['converting', 'importing', 'solving']);
const statusOf = (item: ImportItem) =>
  item.status === 'solved'
    ? 'success'
    : BUSY.has(item.status)
      ? 'busy'
      : item.status === 'solveFailed'
        ? 'danger'
        : undefined;

async function run() {
  importing.value = true;
  try {
    await importAll();
    if (importItems.value.length === 0) await router.replace('/tabs/gallery');
  } catch (error) {
    void showError(error);
  } finally {
    importing.value = false;
  }
}

onIonViewDidLeave(clearImport);
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/gallery" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-pad">
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-for="item in importItems"
            :key="item.id"
            :thumb="imageIcon"
            :title="item.name"
            :subs="[stateOf(item)]"
            :status="statusOf(item)"
            :button="canChoose(item)"
            :chevron="canChoose(item)"
            @click="chooseMethod(item)"
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
    <PlacementMethodSheet v-model:open="methodOpen" @online="solveOnline" />
  </IonPage>
</template>
