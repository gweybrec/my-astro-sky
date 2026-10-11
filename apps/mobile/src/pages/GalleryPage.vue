<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { getPhotos } from '@myastrosky/app-state/api';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneEmptyState from '../components/PhoneEmptyState.vue';
import filterIcon from '../icons/filter.svg?raw';
import plusIcon from '@icons/plus.svg?raw';

// null until the photos are read; the empty state shows only once the backend has answered with none.
const photoCount = ref<number | null>(null);

onMounted(async () => {
  try {
    photoCount.value = (await getPhotos()).length;
  } catch (error) {
    reportError('GalleryPage.getPhotos', error);
  }
});
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
        <!-- Adding photos is a later card: the button shows and does nothing yet. -->
        <PhoneEmptyState
          v-if="photoCount === 0"
          :text="t('mobile.gallery.empty')"
          :button-label="t('batch.modalTitle')"
          :button-icon="plusIcon"
        />
      </div>
    </IonContent>
  </IonPage>
</template>
