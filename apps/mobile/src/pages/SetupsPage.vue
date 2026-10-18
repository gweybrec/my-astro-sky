<script setup lang="ts">
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonList, onIonViewWillEnter } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import { useSetupLines } from '../composables/useSetupLines';
import { useErrorToast } from '../composables/useErrorToast';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneRow from '../components/PhoneRow.vue';
import PhoneFab from '../components/PhoneFab.vue';

// The board "Réglages, setups": the list of setups, each with its gear and its field of view; a tap opens the
// editor, the plus adds a setup.
const { lines, load: read } = useSetupLines();
const router = useRouter();
const { showError } = useErrorToast();

const load = () => read().catch((error) => void showError(error));
void load();
onIonViewWillEnter(() => void load());
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
