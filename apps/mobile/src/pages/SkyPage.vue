<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { IonPage, IonContent, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { catalogsReady } from '../catalogs';
import { createPhoneSkyMap, type PhoneSkyMap } from '../sky-map-setup';
import PhoneSearch from '../components/PhoneSearch.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import AppIcon from '../components/AppIcon.vue';
import SkyLayerButtons from './sky/SkyLayerButtons.vue';
import SkyDisplaySheet from './sky/SkyDisplaySheet.vue';
import layersIcon from '../icons/layers.svg?raw';

// The boards "Ciel" and "Ciel, calques de la carte": the sky map with the search field and the layers button over it;
// the layers button opens the column of the map's toggles, whose last button opens "Ciel, affichage".
const canvas = ref<HTMLCanvasElement | null>(null);
const layersOpen = ref(false);
const displayOpen = ref(false);
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
      <div class="mob-page-fill mob-sky-frame">
        <main class="mob-map">
          <canvas ref="canvas" class="mob-sky-canvas" />
          <div class="mob-map-top">
            <!-- The search screen is the next one: the field is drawn and does not type yet. -->
            <PhoneSearch
              readonly
              :placeholder="t('search.placeholder')"
              :label="t('search.placeholder')"
            />
            <PhoneIconButton
              float
              :label="t('mobile.sky.layers')"
              :expanded="layersOpen"
              @click="layersOpen = !layersOpen"
            >
              <AppIcon :svg="layersIcon" />
            </PhoneIconButton>
          </div>
          <SkyLayerButtons v-if="layersOpen" @display="displayOpen = true" />
        </main>
      </div>
      <SkyDisplaySheet v-model:open="displayOpen" />
    </IonContent>
  </IonPage>
</template>

<style>
.mob-sky-frame {
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top, 0);
}
.mob-sky-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
