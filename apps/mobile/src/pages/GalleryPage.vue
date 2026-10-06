<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonPage, IonHeader, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { getPhotos } from '@myastrosky/app-state/api';
import AppIcon from '../components/AppIcon.vue';
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
    <IonHeader class="mob-topbar">
      <input
        class="mob-search m-body"
        type="search"
        :placeholder="t('photos.searchPlaceholder')"
        :aria-label="t('mobile.gallery.searchLabel')"
      />
      <button type="button" class="mob-icon-btn" :aria-label="t('targets.moreFilters')">
        <AppIcon :svg="filterIcon" />
      </button>
    </IonHeader>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill">
        <div v-if="photoCount === 0" class="mob-empty">
          <p class="mob-empty-text m-body">{{ t('mobile.gallery.empty') }}</p>
          <!-- Adding photos is a later card: the button shows and does nothing yet. -->
          <button type="button" class="mob-btn mob-btn--action mob-btn--lg m-body-strong">
            <AppIcon :svg="plusIcon" />{{ t('batch.modalTitle') }}
          </button>
        </div>
      </div>
    </IonContent>
  </IonPage>
</template>
