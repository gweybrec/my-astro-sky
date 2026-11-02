<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { IonPage, IonContent, IonList } from '@ionic/vue';
import { storeToRefs } from 'pinia';
import { t } from '@myastrosky/core/i18n/index';
import {
  formatDms,
  isValidLatLon,
  parseCoordinate,
  parseDms,
  readExactObserverLocation,
  readObserverLocation,
  roundCoordinate,
  writeObserverLocation,
  type DmsFields,
} from '@myastrosky/core/observer-location';
import { loadTargetsPrefs, saveTargetsPrefs } from '@myastrosky/core/targets/prefs';
import { useHorizonProfileStore } from '@myastrosky/app-state/stores/horizon-profile';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import {
  getCurrentPosition,
  HORIZON_FILE_TYPES,
  LocationDeniedError,
  pickFile,
} from '../platform-device';
import AppIcon from '../components/AppIcon.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneSegmented from '../components/PhoneSegmented.vue';
import PhoneToggleRow from '../components/PhoneToggleRow.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';

// The boards "Réglages, lieu d'observation", "Lieu, saisie en degrés minutes secondes", "Lieu, horizon indisponible"
// and "Lieu, position refusée". The position and the horizon settings are stored under the keys the desktop reads
// (`writeObserverLocation`, the horizon store); decimal or degrees-minutes-seconds entry is the desktop's `coordFormat`.
const format = ref<'decimal' | 'dms'>(loadTargetsPrefs().coordFormat ?? 'decimal');
const formats = [
  { value: 'decimal', label: t('mobile.location.decimal') },
  { value: 'dms', label: t('mobile.location.dms') },
] as const;
const lat = ref('');
const lon = ref('');
const latDms = reactive<DmsFields>({ degrees: '', minutes: '', seconds: '' });
const lonDms = reactive<DmsFields>({ degrees: '', minutes: '', seconds: '' });
const dmsRows = [
  { label: t('targets.location.lat'), fields: latDms },
  { label: t('targets.location.lon'), fields: lonDms },
];
showStored();
const locating = ref(false);
const positionFailed = ref(false);
const positionDenied = ref(false);

const horizon = useHorizonProfileStore();
const { enabled, obsHeightM, loading } = storeToRefs(horizon);
const eyeHeight = ref(obsHeightM.value === null ? '' : String(obsHeightM.value));
const { showError } = useErrorToast();
const { confirm } = useConfirm();

/** Fills both formats from the stored position: the decimal fields rounded, as everywhere, the DMS ones exact. */
function showStored() {
  const shown = readObserverLocation();
  lat.value = shown.lat === null ? '' : String(shown.lat);
  lon.value = shown.lon === null ? '' : String(shown.lon);
  const exact = readExactObserverLocation();
  const empty = { degrees: '', minutes: '', seconds: '' };
  Object.assign(latDms, exact.lat === null ? empty : formatDms(exact.lat));
  Object.assign(lonDms, exact.lon === null ? empty : formatDms(exact.lon));
}

// The choice is kept for the desktop too; the fields of the other format show the stored position, not a half-typed one.
watch(format, (value) => {
  saveTargetsPrefs({ ...loadTargetsPrefs(), coordFormat: value });
  showStored();
});

/** A typed latitude / longitude is kept when both are empty or both in range; a value out of range goes back to the stored one. */
function commitCoordinates() {
  const dms = format.value === 'dms';
  const la = dms ? parseDms(latDms) : parseCoordinate(lat.value);
  const lo = dms ? parseDms(lonDms) : parseCoordinate(lon.value);
  const complete = la !== null && lo !== null;
  // Degrees, minutes and seconds that are typed but not a value (minutes of 60 or more) are refused, not left waiting.
  const unreadable =
    dms &&
    [latDms, lonDms].some(
      (f) => (f.degrees + f.minutes + f.seconds).trim() !== '' && parseDms(f) === null,
    );
  if (unreadable || (complete && !isValidLatLon(la, lo))) {
    showStored();
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
    showStored();
    positionFailed.value = false;
    positionDenied.value = false;
  } catch (error) {
    positionFailed.value = true;
    positionDenied.value = error instanceof LocationDeniedError;
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

async function clearHorizon() {
  const sure = await confirm({
    title: t('horizon.clear'),
    message: t('mobile.location.clearHorizon'),
    confirmLabel: t('horizon.clear'),
    destructive: true,
  });
  if (sure) horizon.clear();
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
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe">
        <PhoneSectionHeader>{{ t('skyTime.locationButton') }}</PhoneSectionHeader>
        <!-- Above the fields: the DMS fields take two rows, and the control must not move under the finger. -->
        <PhoneSegmented v-model="format" :options="formats" :label="t('mobile.location.format')" />
        <div v-if="format === 'decimal'" class="mob-form-row mob-form-row--pair">
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
        <template v-else>
          <div
            v-for="row in dmsRows"
            :key="row.label"
            class="mob-form-row"
            role="group"
            :aria-label="row.label"
          >
            <span class="mob-form-label m-secondary" aria-hidden="true">{{ row.label }}</span>
            <div class="mob-coord-fields">
              <!-- The degrees may be negative (south, west): a number keyboard with its minus sign. -->
              <PhoneField
                v-model="row.fields.degrees"
                bare
                type="number"
                :aria-label="`${row.label} °`"
                @commit="commitCoordinates"
              />
              <span class="mob-coord-unit m-body" aria-hidden="true">°</span>
              <PhoneField
                v-model="row.fields.minutes"
                bare
                inputmode="decimal"
                :aria-label="`${row.label} ′`"
                @commit="commitCoordinates"
              />
              <span class="mob-coord-unit m-body" aria-hidden="true">′</span>
              <PhoneField
                v-model="row.fields.seconds"
                bare
                inputmode="decimal"
                :aria-label="`${row.label} ″`"
                @commit="commitCoordinates"
              />
              <span class="mob-coord-unit m-body" aria-hidden="true">″</span>
            </div>
          </div>
        </template>
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
        <!-- Android asks only once: after a refusal the permission is given back in its settings. -->
        <PhoneHelper v-if="positionDenied" class="mob-status--danger">{{
          t('mobile.location.denied')
        }}</PhoneHelper>

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
          <PhoneButton block @click="clearHorizon">{{ t('horizon.clear') }}</PhoneButton>
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
