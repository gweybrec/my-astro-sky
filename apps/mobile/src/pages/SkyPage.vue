<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, onIonViewDidEnter, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import { catalogsReady } from '../catalogs';
import { clearSkySelection, skyFocus, skySelection } from '../composables/useSkySelection';
import { useBackClose } from '../composables/useBackClose';
import { createPhoneSkyMap, type PhoneSkyMap } from '../sky-map-setup';
import AppIcon from '../components/AppIcon.vue';
import SkyLayerButtons from './sky/SkyLayerButtons.vue';
import SkyDisplaySheet from './sky/SkyDisplaySheet.vue';
import SkyObjectSheet from './sky/SkyObjectSheet.vue';
import SkyTimeBar from './sky/SkyTimeBar.vue';
import SkyTopBar from './sky/SkyTopBar.vue';
import PhoneButton from '../components/PhoneButton.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The boards "Ciel" and "Ciel, calques de la carte": the sky map with the search field, the display button and the date
// button over it; the date button switches the map to the sky at a date and brings the column of the map's toggles.
const canvas = ref<HTMLCanvasElement | null>(null);
const timeBar = ref<InstanceType<typeof SkyTimeBar> | null>(null);
const displayOpen = ref(false);
const router = useRouter();
let sky: PhoneSkyMap | null = null;

onMounted(() => {
  if (!canvas.value) return;
  sky = createPhoneSkyMap(canvas.value);
  sky.select(skySelection.value);
  // The catalogues load after the first screen: the map fills in once they are there.
  catalogsReady()
    .then(() => sky?.catalogsLoaded())
    .catch((error) => reportError('SkyPage.catalogsReady', error));
});

watch(skySelection, (selection) => sky?.select(selection));

// The observing location may have changed in Réglages while this tab stayed mounted; a search may have chosen an
// object to go to.
onIonViewWillEnter(() => sky?.refreshLocation());
onIonViewDidEnter(() => {
  const focus = skyFocus.value;
  if (!focus) return;
  skyFocus.value = null;
  sky?.focus(focus);
});

// The selected object has its sheet; the back button closes it before anything else.
useBackClose(() => skySelection.value !== null, clearSkySelection);

const time = useSkyTimeStore();
const located = computed(() => time.lat !== null && time.lon !== null);
const openLocation = () => void router.push('/settings/location');

const openSearch = () => void router.push('/sky/search');

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
          <SkyTopBar
            @search="openSearch"
            @display="displayOpen = true"
            @date-mode="timeBar?.openPicker()"
          />
          <!-- First start: no observing location yet, the time and place of the sky cannot be shown. -->
          <div v-if="!located" class="mob-map-prompt">
            <p class="m-body">{{ t('targets.location.notSet') }}</p>
            <PhoneButton variant="action" size="lg" @click="openLocation">
              <AppIcon :svg="mapPinIcon" />{{ t('targets.location.label') }}
            </PhoneButton>
          </div>
          <SkyTimeBar ref="timeBar" />
          <SkyLayerButtons v-if="time.mode === 'date'" />
          <Transition name="mob-sheet-slide">
            <SkyObjectSheet
              v-if="skySelection"
              :selection="skySelection"
              @close="clearSkySelection"
            />
          </Transition>
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
