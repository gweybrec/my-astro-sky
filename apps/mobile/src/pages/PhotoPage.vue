<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import type { Photo } from '@myastrosky/core/types';
import { getGearSetups, getPhotos, photoFileUrl } from '@myastrosky/app-state/api';
import { usePhotoZoom } from '../composables/usePhotoZoom';
import { setStatusBarHidden } from '../platform-device';
import { skyPhotoFocus } from '../composables/useSkySelection';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import IdentifyChooseSheet, { type IdentifyKind } from './gallery/IdentifyChooseSheet.vue';
import PhotoInfoSheet from './gallery/PhotoInfoSheet.vue';
import infoIcon from '../icons/info.svg?raw';
import resetIcon from '../icons/rotate-ccw.svg?raw';

// A photo's own screen, from the boards "Photo, détail", "Photo, zoom" and "Photo, informations": the photo on a dark
// stage, the top bar with the photo's name, and the sheet of its information. The whole photo is fitted under the bar,
// so that nothing of it stays hidden behind the bar; zoomed, it runs behind the bar, which stays readable over it. Two
// fingers and a double tap zoom; the button that shows the photo whole again is there only while it is zoomed.
const route = useRoute();
const router = useRouter();

const photo = ref<Photo | null>(null);
const setupName = ref<string>();
const infoOpen = ref(false);
const chooseOpen = ref(false);
// A picture that cannot be read leaves the stage with the photo's name.
const broken = ref(false);

// The part of the stage under the top bar: the whole photo is fitted in it.
const area = ref<HTMLElement | null>(null);
const { zoomed, transform, reset, handlers } = usePhotoZoom(area, () => ({
  width: photo.value?.width ?? 0,
  height: photo.value?.height ?? 0,
}));

const title = computed(() => photo.value?.originalName ?? '');

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

// The photo has the screen: Android's status bar is hidden while this page shows, and comes back when it is left.
onIonViewWillEnter(() => void setStatusBarHidden(true));
onIonViewWillLeave(() => void setStatusBarHidden(false));
onBeforeUnmount(() => void setStatusBarHidden(false));

// As the desktop does: the viewer closes and the map goes to the photo.
function showOnMap() {
  if (!photo.value) return;
  infoOpen.value = false;
  skyPhotoFocus.value = photo.value.id;
  void router.replace('/tabs/sky');
}

const backToGallery = () => void router.replace('/tabs/gallery');

// "Identifier les objets" replaces the photo's sheet by the choice of an identification; its back arrow brings the
// photo's sheet back.
function identify() {
  infoOpen.value = false;
  chooseOpen.value = true;
}
function backToInfo() {
  chooseOpen.value = false;
  infoOpen.value = true;
}
function openIdentification(kind: IdentifyKind) {
  if (!photo.value) return;
  chooseOpen.value = false;
  void router.push(`/gallery/photo/${photo.value.id}/identify/${kind}`);
}

function edit() {
  if (!photo.value) return;
  infoOpen.value = false;
  void router.push(`/gallery/photo/${photo.value.id}/edit`);
}
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-photo-frame">
        <div class="mob-stage mob-stage--viewer mob-photo-stage" v-on="handlers">
          <header
            class="mob-topbar mob-topbar--overlay mob-photo-bar"
            @pointerdown.stop
            @touchstart.stop
          >
            <PhoneBackButton float fallback="/tabs/gallery" />
            <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
            <PhoneIconButton float :label="t('mobile.photo.info')" @click="infoOpen = true">
              <AppIcon :svg="infoIcon" />
            </PhoneIconButton>
          </header>
          <div ref="area" class="mob-photo-area">
            <template v-if="photo">
              <div v-if="broken" class="mob-stage-caption m-secondary">
                {{ photo.originalName }}
              </div>
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
          </div>
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
        @edit="edit"
        @identify="identify"
        @removed="backToGallery"
      />
      <IdentifyChooseSheet
        v-model:open="chooseOpen"
        @back="backToInfo"
        @choose="openIdentification"
      />
    </IonContent>
  </IonPage>
</template>
