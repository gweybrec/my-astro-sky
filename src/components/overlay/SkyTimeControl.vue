<template>
  <div class="sky-time-control" :class="{ 'date-mode': store.mode === 'date' }">
    <!-- Conditional/expanding controls come first in DOM order so they grow into the
         space to the LEFT of the moon/mode-toggle buttons, which stay last and never
         move when entering/leaving date mode. -->
    <template v-if="store.mode === 'date'">
      <button
        ref="readoutBtnRef"
        type="button"
        class="sky-time-readout text-micro"
        :title="t('skyTime.dateLabel')"
        @click.stop="dateTimeOpen = !dateTimeOpen"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
      >
        {{ dateStr }} {{ timeStr }}<span v-if="rateLabel"> · {{ rateLabel }}</span>
      </button>
      <DropdownPanel
        v-model="dateTimeOpen"
        :anchor-el="readoutBtnRef"
        align-right
        min-width="200px"
      >
        <div class="flex flex-col gap-2 px-5 py-3">
          <label class="text-micro uppercase text-[var(--text-label)]">
            {{ t('skyTime.dateLabel') }}
          </label>
          <input v-model="dateStr" type="date" class="targets-coord-input sky-time-input" />
          <label class="text-micro uppercase text-[var(--text-label)]">
            {{ t('skyTime.timeLabel') }}
          </label>
          <input v-model="timeStr" type="time" class="targets-coord-input sky-time-input" />
          <div class="sky-time-rate-steppers">
            <button
              type="button"
              class="btn-icon"
              :title="t('skyTime.speedBackward')"
              @click="store.stepRateBackward()"
            >
              «
            </button>
            <button
              type="button"
              class="btn-icon"
              :title="t('skyTime.stop')"
              @click="store.stopTime()"
            >
              ▪
            </button>
            <button
              type="button"
              class="btn-icon"
              :title="t('skyTime.speedForward')"
              @click="store.stepRateForward()"
            >
              »
            </button>
            <span v-if="rateLabel" class="sky-time-rate-label text-micro">{{ rateLabel }}</span>
            <button
              type="button"
              class="btn-icon sky-time-reset"
              :title="t('skyTime.resetToNow')"
              @click="store.resetToNow()"
            >
              ↺
            </button>
          </div>
        </div>
      </DropdownPanel>

      <button
        ref="locationBtnRef"
        type="button"
        class="sky-rotation-btn"
        :title="t('skyTime.locationButton')"
        :aria-label="t('skyTime.locationButton')"
        @click.stop="openLocation"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="mapPinSvg"
      ></button>
      <DropdownPanel
        v-model="locationOpen"
        :anchor-el="locationBtnRef"
        align-right
        min-width="180px"
      >
        <div class="flex flex-col gap-2 px-5 py-3">
          <label class="text-micro uppercase text-[var(--text-label)]">
            {{ t('skyTime.locationLatLabel') }}
          </label>
          <input
            v-model="latInput"
            type="number"
            class="targets-coord-input"
            step="0.01"
            @change="applyLocation"
          />
          <label class="text-micro uppercase text-[var(--text-label)]">
            {{ t('skyTime.locationLonLabel') }}
          </label>
          <input
            v-model="lonInput"
            type="number"
            class="targets-coord-input"
            step="0.01"
            @change="applyLocation"
          />
          <button
            type="button"
            class="targets-loc-btn sky-time-use-location"
            :disabled="locateStatus === 'locating'"
            @click="useMyLocation"
          >
            {{ locateLabel }}
          </button>
        </div>
      </DropdownPanel>

      <button
        type="button"
        class="sky-rotation-btn"
        :class="{ active: store.showAzimuthGrid }"
        :title="t('skyTime.azimuthGridButton')"
        :aria-label="t('skyTime.azimuthGridButton')"
        @click="store.setShowAzimuthGrid(!store.showAzimuthGrid)"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="azimuthGridSvg"
      ></button>
    </template>

    <button
      type="button"
      class="sky-rotation-btn"
      :class="{ active: store.showMoon }"
      :title="t('skyTime.moonButton')"
      :aria-label="t('skyTime.moonButton')"
      @click="store.setShowMoon(!store.showMoon)"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
      v-html="moonSvg"
    ></button>

    <button
      type="button"
      class="sky-rotation-btn"
      :class="{ active: store.mode === 'date' }"
      :title="store.mode === 'date' ? t('skyTime.liveModeButton') : t('skyTime.dateModeButton')"
      :aria-label="
        store.mode === 'date' ? t('skyTime.liveModeButton') : t('skyTime.dateModeButton')
      "
      @click="toggleMode"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
      v-html="calendarSvg"
    ></button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { t } from '../../i18n';
import { useSkyTimeStore } from '../../stores/sky-time';
import { useUiStore } from '../../stores/ui';
import DropdownPanel from '../base/DropdownPanel.vue';
import calendarSvg from '../../icons/calendar.svg?raw';
import moonSvg from '../../icons/moon.svg?raw';
import mapPinSvg from '../../icons/map-pin.svg?raw';
import azimuthGridSvg from '../../icons/azimuth-grid.svg?raw';

const store = useSkyTimeStore();
const uiStore = useUiStore();

const readoutBtnRef = ref<HTMLButtonElement>();
const dateTimeOpen = ref(false);
const locationBtnRef = ref<HTMLButtonElement>();
const locationOpen = ref(false);

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}

function toggleMode() {
  // Entering date mode: open the date/time popover immediately so the user can set
  // it right away, instead of a bare toggle with no obvious next step.
  const enteringDateMode = store.mode !== 'date';
  store.toggleMode();
  dateTimeOpen.value = enteringDateMode;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeStr(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function applyDateTime(dStr: string, tStr: string) {
  if (!dStr) return;
  const [y, m, day] = dStr.split('-').map(Number);
  const [hh, mm] = (tStr || '00:00').split(':').map(Number);
  store.setSimDate(new Date(y, (m ?? 1) - 1, day ?? 1, hh ?? 0, mm ?? 0));
}

const dateStr = computed({
  get: () => toDateStr(store.simDate),
  set: (v: string) => applyDateTime(v, toTimeStr(store.simDate)),
});
const timeStr = computed({
  get: () => toTimeStr(store.simDate),
  set: (v: string) => applyDateTime(toDateStr(store.simDate), v),
});

// store.effectiveRate is already signed (negative while running backward), so this
// naturally renders e.g. "×-10" when time is going into the past.
const rateLabel = computed(() => {
  const r = store.effectiveRate;
  return r === 0 ? '' : `×${r}`;
});

// Vue's v-model on <input type="number"> coerces the bound value to a `number`
// once non-empty (via its built-in looseToNumber), so these refs are a string
// only while the field is empty — never assume `.trim()`/string methods on them.
const latInput = ref<string | number>('');
const lonInput = ref<string | number>('');
watch(
  () => [store.lat, store.lon] as const,
  ([la, lo]) => {
    latInput.value = la === null ? '' : la;
    lonInput.value = lo === null ? '' : lo;
  },
  { immediate: true },
);

function toNullableNumber(v: string | number): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function applyLocation() {
  store.setLocation(toNullableNumber(latInput.value), toNullableNumber(lonInput.value));
}

function openLocation() {
  store.seedLocationIfNeeded();
  locationOpen.value = !locationOpen.value;
}

// "Use my location" — same Electron-bridge-first / browser-geolocation-fallback
// pattern as the Targets tab's location picker (src/targets-view.ts), reusing its
// i18n strings (targets.location.*) rather than duplicating them.
const locateStatus = ref<'idle' | 'locating' | 'error'>('idle');
const locateLabel = computed(() => {
  if (locateStatus.value === 'locating') return t('targets.location.locating');
  if (locateStatus.value === 'error') return t('targets.location.error');
  return t('targets.location.useBrowser');
});

function useMyLocation() {
  locateStatus.value = 'locating';
  const onSuccess = (latitude: number, longitude: number) => {
    const la = Math.round(latitude * 100) / 100;
    const lo = Math.round(longitude * 100) / 100;
    latInput.value = la;
    lonInput.value = lo;
    store.setLocation(la, lo);
    locateStatus.value = 'idle';
  };
  const onError = () => {
    locateStatus.value = 'error';
  };
  const electronAPI = (
    window as unknown as {
      electronAPI?: { getLocation: () => Promise<{ latitude: number; longitude: number }> };
    }
  ).electronAPI;
  if (electronAPI) {
    electronAPI
      .getLocation()
      .then((c) => onSuccess(c.latitude, c.longitude))
      .catch(onError);
  } else {
    navigator.geolocation.getCurrentPosition(
      (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
      onError,
    );
  }
}
</script>
