<script setup lang="ts">
import { computed } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import type { Photo } from '@myastrosky/core/types';
import { photoFileUrl } from '@myastrosky/app-state/api';
import PhoneInfoButton from '../../components/PhoneInfoButton.vue';
import PhonePhotoStage, { type PhotoPoint } from '../../components/PhonePhotoStage.vue';

// The frame of the pages that identify objects on a solved photo (boards "Identifier un astéroïde", "Identifier des
// supernovae", "Identifier des comètes", "Ajouter un point d'intérêt"), the star identification's layout: the title bar
// of a mode with its "i", the photo on its stage with what the page marks on it (`markers` slot, given `onScreen`),
// and the panel under it, at the right in landscape (default slot). A tap on the photo is given as its pixel (`tap`).
// With `results`, only the panel's list scrolls (`.mob-results-list`); its fields and footer stay.
const props = defineProps<{
  title: string;
  /** The explanation behind the "i": the desktop's introduction of the modal. */
  info: string;
  photo: Photo | null;
  /** The panel's name for assistive technology. */
  panelLabel: string;
  /** The panel holds a list of results: only the list scrolls. */
  results?: boolean;
}>();
const emit = defineEmits<{ tap: [point: PhotoPoint] }>();

const size = computed(() =>
  props.photo ? { width: props.photo.width, height: props.photo.height } : null,
);
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <div class="mob-page-fill mob-map-mode mob-identify-frame">
        <header class="mob-topbar">
          <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ title }}</h1>
          <PhoneInfoButton :title="title" :message="info" />
        </header>
        <PhonePhotoStage
          :src="photo ? photoFileUrl(photo.filename) : ''"
          :alt="photo?.originalName"
          :size="size"
          @tap="emit('tap', $event)"
        >
          <template #default="{ onScreen }">
            <slot name="markers" :on-screen="onScreen" />
          </template>
        </PhonePhotoStage>
        <section
          class="mob-panel mob-identify-panel"
          :class="{ 'mob-panel--results': results }"
          :aria-label="panelLabel"
        >
          <slot />
        </section>
      </div>
    </IonContent>
  </IonPage>
</template>
