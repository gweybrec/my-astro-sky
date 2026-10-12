<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { getAccessories, getCameras, getTelescopes } from '@myastrosky/core/gear-catalog';
import { buildSetupSummary } from '@myastrosky/core/setup-info';
import { resolveSetupGear } from '@myastrosky/core/setup-gear';
import { getGearSetups, type GearSetupData } from '@myastrosky/app-state/api';
import { catalogsReady } from '../catalogs';
import { useErrorToast } from '../composables/useErrorToast';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneFab from '../components/PhoneFab.vue';

// The board "Réglages, setups": the list of setups, each with its gear and its field of view; a tap opens the
// editor, the plus adds a setup.
interface SetupLine {
  setup: GearSetupData;
  /** The two lines under the name; empty when the gear of the setup is no longer in the catalogue. */
  subs: string[];
}

const lines = ref<SetupLine[]>([]);
const router = useRouter();
const { showError } = useErrorToast();

async function load() {
  try {
    await catalogsReady();
    const [setups, telescopes, cameras, accessories] = await Promise.all([
      getGearSetups(),
      getTelescopes(),
      getCameras(),
      getAccessories(),
    ]);
    lines.value = setups.map((setup) => {
      const gear = resolveSetupGear(setup, telescopes, cameras, accessories);
      if (!gear) return { setup, subs: [] };
      const summary = buildSetupSummary(gear.tel, gear.cam, gear.acc);
      return {
        setup,
        subs: [summary.gearLine, t('mobile.gear.summary', { value: summary.fovLabel })],
      };
    });
  } catch (error) {
    void showError(error);
  }
}
load();
onIonViewWillEnter(load);
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('mobile.settings.setups') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-pad mob-page-safe">
        <IonList class="mob-list" lines="none">
          <PhoneRow
            v-for="line in lines"
            :key="line.setup.id"
            :title="line.setup.name"
            :subs="line.subs"
            roomy
            button
            chevron
            @click="router.push(`/settings/setups/${line.setup.id}`)"
          />
        </IonList>
      </div>
      <PhoneFab :label="t('fovOverlay.addSetup')" @click="router.push('/settings/setups/new')" />
    </IonContent>
  </IonPage>
</template>
