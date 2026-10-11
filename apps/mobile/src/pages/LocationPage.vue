<script setup lang="ts">
import { ref } from 'vue';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import {
  isValidLatLon,
  parseCoordinate,
  readObserverLocation,
  roundCoordinate,
  writeObserverLocation,
} from '@myastrosky/core/observer-location';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { useErrorToast } from '../composables/useErrorToast';
import { getCurrentPosition, HORIZON_FILE_TYPES, pickFile } from '../platform-device';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneToggleRow from '../components/PhoneToggleRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The boards "Réglages, lieu d'observation", "Lieu, horizon indisponible" and "Lieu, position refusée". The position
// and the horizon settings are stored under the keys the desktop reads (`writeObserverLocation`, the horizon store).
const stored = readObserverLocation();
const lat = ref(stored.lat === null ? '' : String(stored.lat));
const lon = ref(stored.lon === null ? '' : String(stored.lon));
const locating = ref(false);
const positionFailed = ref(false);

const horizon = useHorizonProfileStore();
const { enabled, obsHeightM, loading } = storeToRefs(horizon);
const eyeHeight = ref(obsHeightM.value === null ? '' : String(obsHeightM.value));
const { showError } = useErrorToast();

function showStored(latitude: number | null, longitude: number | null) {
  lat.value = latitude === null ? '' : String(latitude);
  lon.value = longitude === null ? '' : String(longitude);
}

/** A typed latitude / longitude is kept when both are empty or both in range; a value out of range goes back to the stored one. */
function commitCoordinates() {
  const la = parseCoordinate(lat.value);
  const lo = parseCoordinate(lon.value);
  const complete = la !== null && lo !== null;
  if (complete && !isValidLatLon(la, lo)) {
    const current = readObserverLocation();
    showStored(current.lat, current.lon);
    return;
  }
  // One field alone waits for the other.
  if (!complete && (la !== null || lo !== null)) return;
  writeObserverLocation(la, lo);
}

async function useMyPosition() {
  locating.value = true;
  try {
    const position = await getCurrentPosition();
    const latitude = roundCoordinate(position.latitude);
    const longitude = roundCoordinate(position.longitude);
    writeObserverLocation(latitude, longitude);
    showStored(latitude, longitude);
    positionFailed.value = false;
  } catch {
    positionFailed.value = true;
  } finally {
    locating.value = false;
  }
}

function commitEyeHeight() {
  horizon.setObsHeight(parseCoordinate(eyeHeight.value));
}

async function compute() {
  const loc = readObserverLocation();
  if (!(await horizon.computeFor(loc.lat, loc.lon)) && horizon.error) {
    // The board "Lieu, horizon indisponible" shows the desktop's text whatever the server answered.
    const missing = horizon.error === t('horizon.error.noLocation');
    void showError(new Error(missing ? horizon.error : t('horizon.error.compute')));
  }
}

async function importHorizon() {
  try {
    const file = await pickFile(HORIZON_FILE_TYPES);
    if (!file) return;
    const loc = readObserverLocation();
    if (!horizon.importFromText(await file.text(), loc.lat, loc.lon) && horizon.error) {
      void showError(new Error(horizon.error));
    }
  } catch (error) {
    void showError(error);
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/settings" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">
        {{ t('targets.location.label') }}
      </h1>
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column">
        <PhoneSectionHeader>{{ t('skyTime.locationButton') }}</PhoneSectionHeader>
        <div class="mob-form-row mob-form-row--pair">
          <PhoneField
            v-model="lat"
            bare
            :label="t('targets.location.lat')"
            inputmode="decimal"
            @commit="commitCoordinates"
          />
          <PhoneField
            v-model="lon"
            bare
            :label="t('targets.location.lon')"
            inputmode="decimal"
            @commit="commitCoordinates"
          />
        </div>
        <!-- Entering degrees, minutes and seconds has no board yet: the button shows and does nothing. -->
        <div class="mob-form-row">
          <PhoneButton block waiting>{{ t('mobile.location.dms') }}</PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton
            block
            :variant="positionFailed ? 'danger' : 'default'"
            :disabled="locating"
            @click="useMyPosition"
          >
            <AppIcon :svg="mapPinIcon" />{{
              positionFailed ? t('targets.location.error') : t('targets.location.useBrowser')
            }}
          </PhoneButton>
        </div>

        <PhoneSectionHeader>{{ t('mobile.location.horizonSection') }}</PhoneSectionHeader>
        <PhoneField
          v-model="eyeHeight"
          :label="t('horizon.eyeHeightLabel')"
          placeholder="1.7"
          inputmode="decimal"
          @commit="commitEyeHeight"
        />
        <div class="mob-form-row">
          <PhoneButton block variant="action" :disabled="loading" @click="compute">
            {{ t('horizon.compute') }}
          </PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton block @click="importHorizon">{{ t('horizon.import') }}</PhoneButton>
        </div>
        <div class="mob-form-row">
          <PhoneButton block @click="horizon.clear()">{{ t('horizon.clear') }}</PhoneButton>
        </div>
        <IonList class="mob-list" lines="none">
          <PhoneToggleRow
            :model-value="enabled"
            :title="t('horizon.toggleButton')"
            @update:model-value="horizon.setEnabled"
          />
        </IonList>
      </div>
    </IonContent>
  </IonPage>
</template>
