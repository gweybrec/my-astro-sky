<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { catalogsReady } from '../catalogs';
import { createPhoneSkyMap, type PhoneSkyMap } from '../sky-map-setup';

const canvas = ref<HTMLCanvasElement | null>(null);
let sky: PhoneSkyMap | null = null;

onMounted(() => {
  if (!canvas.value) return;
  sky = createPhoneSkyMap(canvas.value);
  // The catalogues load after the first screen: the map fills in once they are there.
  catalogsReady()
    .then(() => sky?.catalogsLoaded())
    .catch((error) => reportError('SkyPage.catalogsReady', error));
});

// The observing location may have changed in Réglages while this tab stayed mounted.
onIonViewWillEnter(() => sky?.refreshLocation());

onBeforeUnmount(() => {
  sky?.destroy();
  sky = null;
});
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false">
      <canvas ref="canvas" class="mob-sky-canvas" />
    </IonContent>
  </IonPage>
</template>

<style>
.mob-sky-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
