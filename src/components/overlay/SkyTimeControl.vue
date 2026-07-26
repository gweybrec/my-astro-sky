<template>
  <div class="sky-time-control" :class="{ 'date-mode': store.mode === 'date' }">
    <!-- Conditional/expanding controls (including the moon toggle, which only makes
         sense in date mode) come first in DOM order so they grow into the space to the
         LEFT of the mode-toggle button, which stays last and never moves when
         entering/leaving date mode. On screens too narrow for that row to clear the
         top-centred view tabs, `stacked` drops the whole group below the toggle
         instead (see measureFit below). -->
    <div
      v-if="store.mode === 'date'"
      ref="expandedRef"
      class="sky-time-expanded"
      :class="{ stacked }"
    >
      <button
        ref="readoutBtnRef"
        type="button"
        class="sky-time-readout text-micro"
        :title="t('skyTime.dateLabel')"
        @click.stop="dateTimeOpen = !dateTimeOpen"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
      >
        {{ dateStr }} {{ timeStr }} · {{ rateLabel }}<span v-if="store.paused"> ⏸</span>
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
              :title="t('skyTime.setNormalSpeed')"
              @click="store.setRateNormal()"
            >
              ×1
            </button>
            <button
              type="button"
              class="btn-icon"
              :class="{ 'btn-icon--active': store.paused }"
              :title="store.paused ? t('skyTime.play') : t('skyTime.stop')"
              @click="store.togglePaused()"
            >
              {{ store.paused ? '▶' : '⏸' }}
            </button>
            <button
              type="button"
              class="btn-icon"
              :title="t('skyTime.speedForward')"
              @click="store.stepRateForward()"
            >
              »
            </button>
            <button
              type="button"
              class="btn-icon sky-time-reset"
              :title="t('skyTime.resetToNow')"
              @click="store.resetToNow()"
            >
              ↺
            </button>
            <button
              type="button"
              class="btn-icon"
              :title="t('skyTime.jumpToEvening')"
              @click="store.jumpToEvening()"
            >
              🌆
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

          <!-- Terrain (mountain) horizon controls -->
          <div class="border-t border-[var(--border-subtle)] mt-1 pt-2 flex flex-col gap-2">
            <label class="text-micro uppercase text-[var(--text-label)]">
              {{ t('horizon.eyeHeightLabel') }}
            </label>
            <input
              v-model="eyeHeightInput"
              type="number"
              class="targets-coord-input"
              step="1"
              min="0"
              placeholder="1.7"
              @change="applyEyeHeight"
            />
            <button
              type="button"
              class="targets-loc-btn"
              :disabled="horizon.loading || store.lat === null || store.lon === null"
              @click="horizon.computeForCurrentLocation()"
            >
              {{ horizon.loading ? t('horizon.computing') : t('horizon.compute') }}
            </button>
            <button type="button" class="targets-loc-btn" @click="triggerImport">
              {{ t('horizon.import') }}
            </button>
            <input
              ref="fileInputRef"
              type="file"
              accept=".txt,.csv,.hor,.dat"
              class="hidden"
              @change="onImportFile"
            />
            <button
              v-if="horizon.profile"
              type="button"
              class="targets-loc-btn"
              @click="horizon.clear()"
            >
              {{ t('horizon.clear') }}
            </button>
            <p v-if="horizon.error" class="text-micro text-[var(--color-danger)]">
              {{ horizon.error }}
            </p>
          </div>
        </div>
      </DropdownPanel>

      <button
        type="button"
        class="sky-rotation-btn"
        :class="{ active: store.localSkyMode }"
        :disabled="store.lat === null || store.lon === null"
        :title="t('skyTime.localSkyButton')"
        :aria-label="t('skyTime.localSkyButton')"
        @click="store.setLocalSkyMode(!store.localSkyMode)"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="localSkySvg"
      ></button>

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

      <button
        type="button"
        class="sky-rotation-btn"
        :class="{ active: horizon.enabled }"
        :disabled="!horizon.profile"
        :title="t('horizon.toggleButton')"
        :aria-label="t('horizon.toggleButton')"
        @click="horizon.setEnabled(!horizon.enabled)"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="mountainSvg"
      ></button>

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
        :class="{ active: store.showSun }"
        :title="t('skyTime.sunButton')"
        :aria-label="t('skyTime.sunButton')"
        @click="store.setShowSun(!store.showSun)"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="sunSvg"
      ></button>

      <button
        type="button"
        class="sky-rotation-btn"
        :class="{ active: store.showPlanets }"
        :title="t('skyTime.planetsButton')"
        :aria-label="t('skyTime.planetsButton')"
        @click="store.setShowPlanets(!store.showPlanets)"
        @mouseenter="suppress(true)"
        @mouseleave="suppress(false)"
        @focus="suppress(true)"
        @blur="suppress(false)"
        v-html="planetsSvg"
      ></button>
    </div>

    <button
      ref="toggleBtnRef"
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
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { t } from '../../i18n';
import { useSkyTimeStore } from '../../stores/sky-time';
import { useHorizonStore } from '../../stores/horizon';
import { useUiStore } from '../../stores/ui';
import DropdownPanel from '../base/DropdownPanel.vue';
import calendarSvg from '../../icons/calendar.svg?raw';
import moonSvg from '../../icons/moon.svg?raw';
import sunSvg from '../../icons/sun.svg?raw';
import planetsSvg from '../../icons/planets.svg?raw';
import mapPinSvg from '../../icons/map-pin.svg?raw';
import azimuthGridSvg from '../../icons/azimuth-grid.svg?raw';
import localSkySvg from '../../icons/local-sky.svg?raw';
import mountainSvg from '../../icons/mountain.svg?raw';

const store = useSkyTimeStore();
const horizon = useHorizonStore();
const uiStore = useUiStore();

const readoutBtnRef = ref<HTMLButtonElement>();
const dateTimeOpen = ref(false);
const locationBtnRef = ref<HTMLButtonElement>();
const locationOpen = ref(false);

// ── Inline-vs-stacked layout of the date-mode controls ──────────────────────
// The row is right-edge-anchored and grows leftwards, so on a narrow viewport it
// runs into the top-centred #view-tabs. Rather than guess a breakpoint, measure:
// the group's own width and the toggle's left edge are both unaffected by which
// layout is active (the container is right-anchored, and the stacked group keeps
// its shrink-to-fit width), so the test can't oscillate between the two states.
const expandedRef = ref<HTMLElement>();
const toggleBtnRef = ref<HTMLButtonElement>();
const stacked = ref(false);

// Row gap (--space-3) between the group and the toggle, plus the clearance we
// want to keep between the group's left edge and the tabs' right edge.
const ROW_GAP = 6;
const TABS_CLEARANCE = 12;

function measureFit() {
  if (store.mode !== 'date') {
    stacked.value = false;
    return;
  }
  const group = expandedRef.value;
  const toggle = toggleBtnRef.value;
  const tabs = document.getElementById('view-tabs');
  if (!group || !toggle || !tabs) return;
  const tabsRect = tabs.getBoundingClientRect();
  if (tabsRect.width === 0) return; // tabs hidden — nothing to collide with
  const inlineLeft = toggle.getBoundingClientRect().left - ROW_GAP - group.scrollWidth;
  stacked.value = inlineLeft < tabsRect.right + TABS_CLEARANCE;
}

onMounted(() => {
  window.addEventListener('resize', measureFit);
  measureFit();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', measureFit);
});

// Collapsing the side panel moves the row's right anchor (a CSS combinator on
// #side-panel.collapsed), which is a reposition, not a resize — so no observer sees
// it and the store flag is what we have to key off.
watch(
  () => uiStore.panelCollapsed,
  () => void nextTick(measureFit),
);

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
// naturally renders e.g. "×-10" when time is going into the past. It's never 0 — the
// dial's resting pivot is 1x, not a stop (see stores/sky-time.ts) — so always show it.
const rateLabel = computed(() => `×${store.effectiveRate}`);

// Entering date mode mounts the group; re-measure once it has a layout. The readout
// text also changes width with the date and rate, so track those too. (Declared here
// rather than beside measureFit: the getter runs on setup, so it can't reference
// dateStr/rateLabel before their definitions.)
watch(
  () => [store.mode, dateStr.value, rateLabel.value] as const,
  () => void nextTick(measureFit),
);

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

// ── Terrain (mountain) horizon ──────────────────────────────────────────────
const fileInputRef = ref<HTMLInputElement>();
const eyeHeightInput = ref<string | number>('');
watch(
  () => horizon.obsHeightM,
  (h) => {
    eyeHeightInput.value = h === null ? '' : h;
  },
  { immediate: true },
);

function applyEyeHeight() {
  horizon.setObsHeight(toNullableNumber(eyeHeightInput.value));
}

function triggerImport() {
  fileInputRef.value?.click();
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  horizon.importFromText(text);
  input.value = ''; // allow re-importing the same file
}

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
