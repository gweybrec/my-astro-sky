<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonInput } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
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
import AppIcon from '../../components/AppIcon.vue';
import { formatLongDuration } from '../../composables/usePlans';
import caretIcon from '../../icons/chevron-down.svg?raw';

// The board "Plan, fenêtre d'observation": the window's start and end, its duration and number of exposures, its
// filter and colour, the single exposure and the switch that aligns the window on it. "Enregistrer" stores the
// exposure and the switch; "Supprimer" removes the window (the page asks first). The start and end fields, the filter
// and the colour open pickers that have no board yet: they show their value and do nothing.
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
  save: [changes: { frameSeconds: number | null; snap: boolean }];
  delete: [];
}>();

const frameText = ref('');
const snap = ref(false);

// The draft starts from the stored window each time a window is opened.
watch(
  () => [open.value, props.window?.id] as const,
  () => {
    frameText.value = props.window?.frameSeconds != null ? String(props.window.frameSeconds) : '';
    snap.value = props.window?.snap ?? false;
  },
  { immediate: true },
);

const nightSpanMs = computed(() =>
  props.night ? props.night.end.getTime() - props.night.start.getTime() : 0,
);
const durationMs = computed(() =>
  props.window && props.night ? windowDurationMs(props.window, nightSpanMs.value) : null,
);
const frameSeconds = computed(() => parseFrameSeconds(frameText.value));
const frames = computed(() =>
  durationMs.value !== null && frameSeconds.value
    ? Math.floor(durationMs.value / 1000 / frameSeconds.value)
    : null,
);
const clock = (frac: number | undefined) =>
  props.night && frac !== undefined ? fracToClock(frac, props.night) : '';
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
  emit('save', { frameSeconds: frameSeconds.value, snap: snap.value });
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
        :model-value="clock(window?.startFrac)"
        bare
        readonly
        :label="t('mobile.plans.windowStart')"
      />
      <PhoneField
        :model-value="clock(window?.endFrac)"
        bare
        readonly
        :label="t('mobile.plans.windowEnd')"
      />
    </div>
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
