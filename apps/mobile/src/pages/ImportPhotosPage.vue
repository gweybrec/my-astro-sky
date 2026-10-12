<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewDidLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useErrorToast } from '../composables/useErrorToast';
import {
  clearImport,
  importBusy,
  importItems,
  importSolved,
  solvedCount,
  type ImportItem,
} from '../composables/usePhotoImport';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneBusy from '../components/PhoneBusy.vue';
import imageIcon from '@icons/image.svg?raw';

// The page "Importer des photos": one row per chosen file with where it stands, and the button that stores the photos.
// A solved TIFF or FITS says where the photo is on the sky, so it is placed as soon as it is read; the other photos
// wait for a placement method, which has no screen built yet.
const router = useRouter();
const { showError } = useErrorToast();
const importing = ref(false);

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
    default:
      return t('mobile.gallery.toPlace');
  }
};

const statusOf = (item: ImportItem) =>
  item.status === 'solved'
    ? 'success'
    : item.status === 'converting' || item.status === 'importing'
      ? 'busy'
      : undefined;

async function run() {
  importing.value = true;
  try {
    await importSolved();
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
            :inert="item.status === 'toPlace'"
            :chevron="item.status === 'toPlace'"
          />
        </IonList>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton
        variant="confirm"
        size="lg"
        block
        :disabled="solvedCount === 0 || importBusy || importing"
        @click="run"
        >{{ t('mobile.gallery.import') }}</PhoneButton
      >
    </PhoneFooter>
  </IonPage>
</template>
