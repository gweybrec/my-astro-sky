<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { getGearSetups, getPhotos, photoFileUrl } from '@myastrosky/app-state/api';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { skyPhotoFocus } from '../composables/useSkySelection';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhotoInfoSheet from './gallery/PhotoInfoSheet.vue';
import infoIcon from '../icons/info.svg?raw';
import resetIcon from '../icons/rotate-ccw.svg?raw';

// A photo's own screen, from the boards "Photo, détail", "Photo, zoom" and "Photo, informations": the photo whole on a
// dark stage, the top bar over it with the photo's first object, and the sheet of its information. Two fingers and a
// double tap zoom; the button that shows the photo whole again is there only while it is zoomed.
const route = useRoute();
const router = useRouter();

const photo = ref<Photo | null>(null);
const setupName = ref<string>();
const infoOpen = ref(false);
// A picture that cannot be read leaves the stage with the photo's name.
const broken = ref(false);

const stage = ref<HTMLElement | null>(null);
const { zoomed, transform, reset, handlers } = usePhotoZoom(stage, () => ({
  width: photo.value?.width ?? 0,
  height: photo.value?.height ?? 0,
}));

const title = computed(() => photo.value?.dsoIds?.[0] ?? photo.value?.originalName ?? '');

async function load() {
  try {
    const id = String(route.params.id);
    const found = (await getPhotos()).find((p) => p.id === id);
    if (!found) {
      await router.replace('/tabs/gallery');
      return;
    }
    if (found.id !== photo.value?.id) {
      broken.value = false;
      reset();
    }
    photo.value = found;
    setupName.value = found.gearSetupId
      ? (await getGearSetups()).find((s) => s.id === found.gearSetupId)?.name
      : undefined;
  } catch (error) {
    reportError('PhotoPage.load', error);
  }
}
onMounted(load);
onIonViewWillEnter(load);

// As the desktop does: the viewer closes and the map goes to the photo.
function showOnMap() {
  if (!photo.value) return;
  infoOpen.value = false;
  skyPhotoFocus.value = photo.value.id;
  void router.replace('/tabs/sky');
}

const backToGallery = () => void router.replace('/tabs/gallery');
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-photo-frame">
        <div ref="stage" class="mob-stage mob-stage--viewer mob-photo-stage" v-on="handlers">
          <template v-if="photo">
            <div v-if="broken" class="mob-stage-caption m-secondary">{{ photo.originalName }}</div>
            <img
              v-else
              class="mob-photo-view"
              :src="photoFileUrl(photo.filename)"
              :alt="photo.originalName"
              :style="{ transform }"
              draggable="false"
              @error="broken = true"
            />
          </template>
          <header class="mob-topbar mob-topbar--overlay" @pointerdown.stop @touchstart.stop>
            <PhoneBackButton float fallback="/tabs/gallery" />
            <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
            <PhoneIconButton float :label="t('mobile.photo.info')" @click="infoOpen = true">
              <AppIcon :svg="infoIcon" />
            </PhoneIconButton>
          </header>
          <PhoneIconButton
            v-if="zoomed"
            float
            class="mob-float-br"
            :label="t('mobile.photo.resetZoom')"
            @pointerdown.stop
            @touchstart.stop
            @click="reset"
          >
            <AppIcon :svg="resetIcon" />
          </PhoneIconButton>
        </div>
      </div>
      <PhotoInfoSheet
        v-if="photo"
        v-model:open="infoOpen"
        :photo="photo"
        :setup-name="setupName"
        @map="showOnMap"
        @removed="backToGallery"
      />
    </IonContent>
  </IonPage>
</template>
