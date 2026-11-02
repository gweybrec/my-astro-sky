<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  MIN_WINDOW_FRAC,
  clockToFrac,
  cssColorToHex,
  fracToClock,
  parseFrameSeconds,
  windowDurationMs,
} from '@myastrosky/core/observation-windows';
import type { ObservationWindow } from '@myastrosky/app-state/api';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import PhoneToggleRow from '../../components/PhoneToggleRow.vue';
import PhoneNativePicker from '../../components/PhoneNativePicker.vue';
import PhoneColorButton from '../../components/PhoneColorButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import ObsWindowFilterSheet from './ObsWindowFilterSheet.vue';
import { formatLongDuration } from '../../composables/usePlans';
import { filterColor } from '../../filter-color';
import caretIcon from '../../icons/chevron-down.svg?raw';

/** What the sheet edits of a window, stored by "Enregistrer". */
export type WindowChanges = Pick<
  ObservationWindow,
  'startFrac' | 'endFrac' | 'frameSeconds' | 'snap' | 'filter' | 'color'
>;

// The board "Plan, fenêtre d'observation": the window's start and end, its duration and number of exposures, its
// filter and colour, the single exposure and the switch that aligns the window on it. A tap on the start or the end
// opens the phone's time picker; as on the desktop, a window keeps a minimum length. "Enregistrer" stores the times,
// the exposure and the switch; "Supprimer" removes the window (the page asks first). A new window (board "Plan, nouvelle
// fenêtre d'observation", `isNew`) is not stored yet: it has "Annuler" instead, which leaves it unsaved. The filter opens
// its list (board "Plan, fenêtre d'observation, filtre"); its "Ajouter un filtre" gives the page the window as edited,
// which leaves for the filter's add page and opens the window again on its return. The colour opens the phone's colour
// picker; as on the desktop, a window without a colour of its own takes its filter's, and follows a new filter.
const props = defineProps<{
  window: ObservationWindow | null;
  /** What the window belongs to: the target and the setup. */
  subtitle: string;
  /** The night the window's fractions are read in; null when the plan has no location. */
  night: { start: Date; end: Date } | null;
  /** A window being added, stored only by "Enregistrer". */
  isNew?: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  save: [changes: WindowChanges];
  delete: [];
  addFilter: [changes: WindowChanges];
}>();

const frameText = ref('');
const snap = ref(false);
const startFrac = ref(0);
const endFrac = ref(1);
const filter = ref<string | null>(null);
const color = ref<string | null>(null);
const filterOpen = ref(false);
const startPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);
const endPicker = ref<InstanceType<typeof PhoneNativePicker> | null>(null);

// The draft starts from the stored window each time a window is opened.
watch(
  () => [open.value, props.window?.id] as const,
  () => {
    frameText.value = props.window?.frameSeconds != null ? String(props.window.frameSeconds) : '';
    snap.value = props.window?.snap ?? false;
    startFrac.value = props.window?.startFrac ?? 0;
    endFrac.value = props.window?.endFrac ?? 1;
    filter.value = props.window?.filter ?? null;
    color.value = props.window?.color ?? null;
  },
  { immediate: true },
);

const nightSpanMs = computed(() =>
  props.night ? props.night.end.getTime() - props.night.start.getTime() : 0,
);
const durationMs = computed(() =>
  props.window && props.night
    ? windowDurationMs(
        { ...props.window, startFrac: startFrac.value, endFrac: endFrac.value },
        nightSpanMs.value,
      )
    : null,
);
const frameSeconds = computed(() => parseFrameSeconds(frameText.value));
const frames = computed(() =>
  durationMs.value !== null && frameSeconds.value
    ? Math.floor(durationMs.value / 1000 / frameSeconds.value)
    : null,
);
const clock = (frac: number) => (props.night ? fracToClock(frac, props.night) : '');

function pickStart(hhmm: string) {
  const frac = props.night ? clockToFrac(hhmm, props.night) : null;
  if (frac !== null) startFrac.value = Math.min(frac, endFrac.value - MIN_WINDOW_FRAC);
}
function pickEnd(hhmm: string) {
  const frac = props.night ? clockToFrac(hhmm, props.night) : null;
  if (frac !== null) endFrac.value = Math.max(frac, startFrac.value + MIN_WINDOW_FRAC);
}
const durationText = computed(() => {
  if (durationMs.value === null) return '';
  const duration = formatLongDuration(durationMs.value);
  return frames.value !== null
    ? t('mobile.plans.durationFrames', { duration, n: frames.value, s: frameSeconds.value ?? 0 })
    : t('mobile.plans.durationLine', { duration });
});
const filterName = computed(() => filter.value ?? '');
// The colour picker takes a hex colour: the window's own, else its filter's.
const colorValue = computed({
  get: () => color.value || cssColorToHex(filterColor(filter.value)),
  set: (hex: string) => {
    color.value = hex;
  },
});
const colorAria = computed(() =>
  color.value
    ? t('targets.plan.obsWindowColor')
    : t('mobile.format.labelValue', {
        label: t('targets.plan.obsWindowColor'),
        value: t('mobile.plans.colorFromFilter'),
      }),
);

const changes = (): WindowChanges => ({
  startFrac: startFrac.value,
  endFrac: endFrac.value,
  frameSeconds: frameSeconds.value,
  snap: snap.value,
  filter: filter.value,
  color: color.value,
});

function addFilter() {
  filterOpen.value = false;
  emit('addFilter', changes());
}
</script>

<template>
  <PhoneSheet
    v-model:open="open"
    :title="t('targets.plan.obsWindowTitle')"
    :subtitle="subtitle"
    tall
  >
    <div class="mob-form-row mob-form-row--pair">
      <PhoneField
        :model-value="clock(startFrac)"
        bare
        readonly
        :label="t('mobile.plans.windowStart')"
        @click="startPicker?.open()"
      />
      <PhoneField
        :model-value="clock(endFrac)"
        bare
        readonly
        :label="t('mobile.plans.windowEnd')"
        @click="endPicker?.open()"
      />
    </div>
    <PhoneNativePicker ref="startPicker" type="time" :value="clock(startFrac)" @pick="pickStart" />
    <PhoneNativePicker ref="endPicker" type="time" :value="clock(endFrac)" @pick="pickEnd" />
    <PhoneHelper v-if="durationText">{{ durationText }}</PhoneHelper>
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton
        variant="field"
        text-style="body"
        block
        :aria-label="
          t('mobile.format.labelValue', {
            label: t('targets.plan.obsWindowFilter'),
            value: filterName,
          })
        "
        @click="filterOpen = true"
      >
        <span class="mob-btn-key">{{ t('targets.plan.obsWindowFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ filterName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneColorButton
        v-model="colorValue"
        :field="t('targets.plan.obsWindowColor')"
        :label="colorAria"
      />
    </div>
    <div class="mob-input-row">
      <label class="m-body" for="obs-frame">{{ t('mobile.plans.frame') }}</label>
      <span class="mob-input-row-derived m-mono">{{ frames ?? '' }}</span>
      <span class="mob-input-row-unit m-body" aria-hidden="true">{{
        frames !== null ? '×' : ''
      }}</span>
      <IonInput
        id="obs-frame"
        v-model="frameText"
        class="mob-field m-body"
        type="text"
        inputmode="numeric"
      />
      <span class="mob-input-row-unit m-body">{{ t('targets.plan.obsWindowFrameUnit') }}</span>
    </div>
    <PhoneToggleRow
      v-model="snap"
      :title="t('mobile.plans.snap')"
      :info="t('targets.plan.obsWindowSnap')"
    />
    <template #footer>
      <PhoneButton v-if="isNew" size="lg" @click="open = false">{{
        t('modal.cancel')
      }}</PhoneButton>
      <PhoneButton v-else variant="danger" size="lg" @click="emit('delete')">{{
        t('mobile.plans.delete')
      }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="emit('save', changes())">{{
        t('mobile.plans.save')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
  <ObsWindowFilterSheet v-model:open="filterOpen" v-model:value="filter" @add="addFilter" />
</template>
