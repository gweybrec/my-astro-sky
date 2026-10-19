<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { getDSOById, sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import {
  filterDrawOrderPhotos,
  fullPhotoOrder,
  mergeFilteredOrder,
} from '@myastrosky/core/photo-draw-order';
import type { Photo } from '@myastrosky/core/types';
import { getPhotos, updatePhotoOrder } from '@myastrosky/app-state/api';
import { skyDrawOrder } from '../sky-draw-order';
import { useErrorToast } from '../composables/useErrorToast';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneToggleRow from '../components/PhoneToggleRow.vue';
import PhoneReorderList from '../components/PhoneReorderList.vue';
import AppIcon from '../components/AppIcon.vue';
import imageIcon from '@icons/image.svg?raw';

// The board "Ciel, ordre d'affichage", opened from a photo's sheet on the map: the placed photos, the one drawn on top
// first, the photo of the sheet highlighted. As the desktop's "Ordre d'affichage" window, the list can be searched
// and kept to the photos overlapping the chosen one on the map; a drag moves only among the photos listed, the others
// keep their places. The new order shows on the map at once and is saved.
const router = useRouter();
const { showError } = useErrorToast();
const request = skyDrawOrder.value;

const photosById = new Map<string, Photo>(
  (request?.layer.getPlacedPhotos() ?? []).map((p) => [p.photo.id, p.photo]),
);
/** Every placed photo's id, the one drawn on top first. */
const order = ref<string[]>(
  (request?.layer.getPlacedPhotos() ?? []).map((p) => p.photo.id).reverse(),
);
const query = ref('');
const overlapOnly = ref(true);

const listed = computed<Photo[]>(() => {
  if (!request) return [];
  const photos = order.value.map((id) => photosById.get(id)!);
  return filterDrawOrderPhotos(
    photos,
    query.value,
    overlapOnly.value,
    request.photoId,
    request.quads,
  );
});

/** The row's title is the photo's most important object, its file name under it; without an object, the file name alone. */
function rowText(photo: Photo): { title: string; sub?: string } {
  const id = sortDsoIdsByImportance(photo.dsoIds ?? [])[0];
  if (!id) return { title: photo.originalName };
  const dso = getDSOById(id);
  return { title: dso ? dso.catalogs[0] || dso.id : id, sub: photo.originalName };
}

async function onReorder(listedIds: string[]) {
  if (!request) return;
  const previous = order.value;
  const next = mergeFilteredOrder(previous, listedIds, new Set(listed.value.map((p) => p.id)));
  order.value = next;
  // The layer and the save run from the bottom photo up.
  request.layer.setPhotoOrder([...next].reverse());
  try {
    const all = (await getPhotos()).map((p) => p.id);
    await updatePhotoOrder(fullPhotoOrder(all, [...next].reverse()));
  } catch (error) {
    order.value = previous;
    request.layer.setPhotoOrder([...previous].reverse());
    void showError(error);
  }
}

// Opened without the map's request (the app was reloaded on this address): there is nothing to order.
onMounted(() => {
  if (!request) void router.replace('/tabs/sky');
});
onBeforeUnmount(() => {
  if (skyDrawOrder.value === request) skyDrawOrder.value = null;
});
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/sky" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t('photos.zOrder') }}</h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div
        class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-page-pad mob-page-stack"
      >
        <PhoneField
          v-model="query"
          type="search"
          :aria-label="t('photos.searchPlaceholder')"
          :placeholder="t('photos.searchPlaceholder')"
        />
        <PhoneToggleRow v-model="overlapOnly" :title="t('photos.overlapOnly')" />
        <div v-if="listed.length === 0" class="mob-empty">
          <p class="mob-empty-text m-body">{{ t('photos.drawOrderEmpty') }}</p>
        </div>
        <PhoneReorderList
          v-else
          style="margin-top: var(--space-4)"
          :items="
            listed.map((p) => ({
              id: p.id,
              handleLabel: t('mobile.plans.drag', { name: p.originalName }),
            }))
          "
          :current="request?.photoId"
          @reorder="onReorder"
        >
          <template #default="{ id }">
            <template v-for="photo in listed.filter((p) => p.id === id)" :key="photo.id">
              <span class="mob-row-thumb"><AppIcon :svg="imageIcon" /></span>
              <span class="mob-row-body">
                <span class="mob-row-title m-body">{{ rowText(photo).title }}</span>
                <span v-if="rowText(photo).sub" class="mob-row-sub m-secondary">{{
                  rowText(photo).sub
                }}</span>
              </span>
            </template>
          </template>
        </PhoneReorderList>
      </div>
    </IonContent>
  </IonPage>
</template>
