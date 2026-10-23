<script setup lang="ts">
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonButton, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import type { SkyRegionData } from '@myastrosky/core/domain/regions';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import { readObserverLocation } from '@myastrosky/core/observer-location';
import { skyRegionDraw, skyRegionView } from '../sky-modes';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import { reloadTargetsPrefs, targetsPrefs, updateTargetsPrefs } from '../composables/useTargets';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneFab from '../components/PhoneFab.vue';
import pinIcon from '@icons/map-pin.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Cibles, régions du ciel": "Tout le ciel" and the saved regions, one of which filters the targets. A tap on
// a name chooses it at once; the pin shows the region on the sky map (board "Voir une région") and the plus draws a new
// one there (board "Dessiner une région"). Both need the observing location, as on the desktop: the map is in local sky.
const store = useSkyRegionsStore();
const router = useRouter();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

function load() {
  reloadTargetsPrefs();
  store.ensureLoaded().catch((error) => void showError(error));
}
load();
onIonViewWillEnter(load);

const choose = (id: string | null) => updateTargetsPrefs({ skyRegionId: id ?? undefined });

// The map replaces this page and opens it again when the mode ends.
function toMap(start: () => void) {
  const { lat, lon } = readObserverLocation();
  if (lat === null || lon === null) {
    void showError(new Error(t('horizon.error.noLocation')));
    return;
  }
  start();
  void router.replace('/tabs/sky');
}
const draw = () => toMap(() => (skyRegionDraw.value = { returnTo: '/targets/regions' }));
const view = (region: SkyRegionData) =>
  toMap(() => (skyRegionView.value = { region, returnTo: '/targets/regions' }));

async function remove(region: { id: string; name: string }) {
  const sure = await confirm({
    title: t('targets.skyRegion.deleteConfirmTitle'),
    message: t('targets.skyRegion.deleteConfirmMessage', { name: region.name }),
    confirmLabel: t('targets.skyRegion.delete'),
    destructive: true,
  });
  if (!sure) return;
  try {
    await store.remove(region.id);
    if (targetsPrefs.skyRegionId === region.id) choose(null);
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/targets" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('targets.skyRegion.label') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-safe" style="padding-top: var(--space-4)">
        <div
          class="mob-region-list"
          role="radiogroup"
          :aria-label="t('targets.skyRegion.label')"
          style="background: var(--bg-panel)"
        >
          <div class="mob-row mob-row--region">
            <IonButton
              fill="clear"
              class="mob-row-main m-body"
              :class="{ 'mob-row-main--checked': !targetsPrefs.skyRegionId }"
              role="radio"
              :aria-checked="String(!targetsPrefs.skyRegionId)"
              @click="choose(null)"
            >
              <span class="mob-row-main-line"
                ><span class="mob-radio-mark" /><span>{{ t('targets.skyRegion.none') }}</span></span
              >
            </IonButton>
          </div>
          <div v-for="region in store.regions" :key="region.id" class="mob-row mob-row--region">
            <IonButton
              fill="clear"
              class="mob-row-main m-body"
              :class="{ 'mob-row-main--checked': targetsPrefs.skyRegionId === region.id }"
              role="radio"
              :aria-checked="String(targetsPrefs.skyRegionId === region.id)"
              @click="choose(region.id)"
            >
              <span class="mob-row-main-line"
                ><span class="mob-radio-mark" />
                <span class="mob-swatch" :style="{ background: region.color }" />
                <span>{{ region.name }}</span></span
              >
            </IonButton>
            <PhoneIconButton
              :label="t('mobile.targets.regionView', { name: region.name })"
              @click="view(region)"
            >
              <AppIcon :svg="pinIcon" />
            </PhoneIconButton>
            <PhoneIconButton
              danger
              :label="t('mobile.targets.regionDelete', { name: region.name })"
              @click="remove(region)"
            >
              <AppIcon :svg="trashIcon" />
            </PhoneIconButton>
          </div>
        </div>
      </div>
      <PhoneFab :label="t('mobile.targets.regionDraw')" @click="draw" />
    </IonContent>
  </IonPage>
</template>
