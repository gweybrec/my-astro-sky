<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { sortGalleryPhotos } from '@myastrosky/core/gallery-filter';
import { selectedPhotoBytes } from '@myastrosky/core/backup-selection';
import { cleanSkyName, shareFileName } from '@myastrosky/core/domain/shared-sky';
import type { Photo } from '@myastrosky/core/types';
import { getPhotos, getShareSenderName } from '@myastrosky/app-state/api';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { useErrorToast } from '../composables/useErrorToast';
import { gallerySort } from '../gallery-display';
import { isPlaced } from '../sky-map-setup';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneCheckRow from '../components/PhoneCheckRow.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneSheet from '../components/PhoneSheet.vue';
import caretIcon from '../icons/chevron-down.svg?raw';

// The board "Partager mon ciel": the name shown, whether gear travels (ticked at first), the photos (the photos on the
// map, all ticked at first, picked in the backup's photo sheet), then "Créer le fichier", which writes the file and
// hands it to the phone's share menu. The desktop's "Share my sky" window.
const router = useRouter();
const store = useSharedSkiesStore();
const { showError, showNotice } = useErrorToast();

const senderName = ref('');
const includeGear = ref(true);
const photos = ref<Photo[]>([]);
const sortedPhotos = computed(() => sortGalleryPhotos(photos.value, gallerySort.value));
const selected = ref(new Set<string>());
const photosOpen = ref(false);
const sharing = ref(false);

onMounted(async () => {
  try {
    const [list, name] = await Promise.all([getPhotos(), getShareSenderName()]);
    photos.value = list.filter(isPlaced);
    selected.value = new Set(photos.value.map((p) => p.id));
    if (!senderName.value) senderName.value = name;
  } catch (error) {
    void showError(error);
  }
});

const sizeLabel = computed(() =>
  selected.value.size > 0
    ? t('settings.exportEstimatedSize', {
        size: formatBytes(selectedPhotoBytes(photos.value, selected.value)),
      })
    : '',
);
const canShare = computed(() => selected.value.size > 0 && cleanSkyName(senderName.value) !== '');
const allPhotosTicked = computed(
  () => photos.value.length > 0 && photos.value.every((p) => selected.value.has(p.id)),
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

async function share() {
  if (sharing.value || !canShare.value) return;
  sharing.value = true;
  try {
    await store.share({
      senderName: senderName.value,
      includeGear: includeGear.value,
      ids: sortedPhotos.value.filter((p) => selected.value.has(p.id)).map((p) => p.id),
    });
    void showNotice(t('sharedSky.shareStarted', { name: shareFileName(senderName.value) }));
    router.back();
  } catch (error) {
    void showError(error);
  } finally {
    sharing.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/settings/shared-skies" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('sharedSky.shareTitle') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-section-gap-sm">
        <PhoneField v-model="senderName" :label="t('sharedSky.nameLabel')" />
        <div class="mob-section-gap-sm"></div>
        <IonList class="mob-list" lines="none">
          <PhoneCheckRow v-model="includeGear" :title="t('sharedSky.includeGear')" />
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
                label: t('photos.section'),
                value: `${selected.size} / ${photos.length}`,
              })
            "
            @click="photosOpen = true"
          >
            <span class="mob-btn-key">{{ t('photos.section') }}</span>
            <span class="mob-btn-value mob-btn-value--swatch"
              >{{ selected.size }} / {{ photos.length }}</span
            >
            <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
          </PhoneButton>
        </div>
        <PhoneHelper v-if="sizeLabel">{{ sizeLabel }}</PhoneHelper>
        <PhoneHelper>{{ t('sharedSky.shareAnyone') }}</PhoneHelper>
        <div class="mob-form-row">
          <PhoneButton
            variant="confirm"
            size="lg"
            block
            :busy="sharing"
            :disabled="!sharing && !canShare"
            @click="share"
          >
            {{ t('sharedSky.shareConfirm') }}
          </PhoneButton>
        </div>
      </div>
    </IonContent>
    <PhoneSheet v-model:open="photosOpen" :title="t('photos.section')">
      <IonList class="mob-list" lines="none">
        <PhoneCheckRow
          :model-value="allPhotosTicked"
          :title="t('settings.exportSelectAll')"
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
