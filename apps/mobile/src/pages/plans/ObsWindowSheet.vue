<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  MIN_WINDOW_FRAC,
  clockToFrac,
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
import AppIcon from '../../components/AppIcon.vue';
import { formatLongDuration } from '../../composables/usePlans';
import caretIcon from '../../icons/chevron-down.svg?raw';

// The board "Plan, fenêtre d'observation": the window's start and end, its duration and number of exposures, its
// filter and colour, the single exposure and the switch that aligns the window on it. A tap on the start or the end
// opens the phone's time picker; as on the desktop, a window keeps a minimum length. "Enregistrer" stores the times,
// the exposure and the switch; "Supprimer" removes the window (the page asks first). The filter and the colour open
// pickers that are not built yet: they show their value and do nothing.
const props = defineProps<{
  window: ObservationWindow | null;
  /** What the window belongs to: the target and the setup. */
  subtitle: string;
  /** The night the window's fractions are read in; null when the plan has no location. */
  night: { start: Date; end: Date } | null;
  /** The colour dot of the window (the filter's, or the one chosen). */
  swatch: string;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  save: [
    changes: { startFrac: number; endFrac: number; frameSeconds: number | null; snap: boolean },
  ];
  delete: [];
}>();

const frameText = ref('');
const snap = ref(false);
const startFrac = ref(0);
const endFrac = ref(1);
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
const filterName = computed(() => props.window?.filter ?? '');
const colorAria = computed(() =>
  props.window?.color
    ? t('targets.plan.obsWindowColor')
    : `${t('targets.plan.obsWindowColor')} : ${t('mobile.plans.colorFromFilter')}`,
);

function save() {
  emit('save', {
    startFrac: startFrac.value,
    endFrac: endFrac.value,
    frameSeconds: frameSeconds.value,
    snap: snap.value,
  });
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
        waiting
        :aria-label="`${t('targets.plan.obsWindowFilter')} : ${filterName}`"
      >
        <span class="mob-btn-key">{{ t('targets.plan.obsWindowFilter') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{ filterName }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <div class="mob-form-row" style="padding-bottom: var(--space-4)">
      <PhoneButton variant="field" text-style="body" block waiting :aria-label="colorAria">
        <span class="mob-btn-key">{{ t('targets.plan.obsWindowColor') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch"
          ><span class="mob-swatch" :style="{ background: swatch }"
        /></span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
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
      <PhoneButton variant="danger" size="lg" @click="emit('delete')">{{
        t('mobile.plans.delete')
      }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" @click="save">{{
        t('mobile.plans.save')
      }}</PhoneButton>
    </template>
  </PhoneSheet>
</template>
