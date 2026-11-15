<template>
  <div class="flex flex-col gap-2" data-test="batch-status">
    <!-- Where the placement stands -->
    <template v-if="item.status === 'converting'">
      <div class="flex items-center gap-4 text-secondary">
        <span class="auto-solve-spinner"></span>
        <span>{{
          item.convertProgress < 1
            ? t('batch.convertingUpload', { pct: String(Math.round(item.convertProgress * 100)) })
            : t('batch.convertingDecode')
        }}</span>
      </div>
    </template>

    <template v-else-if="item.status === 'solving'">
      <div class="flex items-center gap-4 flex-wrap text-secondary">
        <span class="auto-solve-spinner"></span>
        <span>{{ solvingText }}</span>
        <button
          v-if="item.solveAbort"
          type="button"
          class="solve-cancel-btn"
          :title="t('modal.cancelSolve')"
          :aria-label="t('modal.cancelSolve')"
          v-html="closeXSvg"
          @click.stop="$emit('cancel')"
        ></button>
      </div>
      <div v-if="slowHint" class="text-base text-dim">{{ slowHint }}</div>
    </template>

    <template v-else-if="item.status === 'waiting'">
      <div class="text-secondary">{{ t('batch.statusWaiting', { max: String(maxParallel) }) }}</div>
    </template>

    <template v-else-if="item.status === 'failed'">
      <div class="text-[var(--status-error-text)]">
        {{ t('batch.statusFailedWith', { error: item.error || t('batch.statusFailed') }) }}
      </div>
      <details v-if="item.diagnostics">
        <summary class="solve-error-summary">{{ t('modal.errorDetailsSummary') }}</summary>
        <pre class="solve-error-pre">{{ item.diagnostics }}</pre>
      </details>
    </template>

    <template v-else-if="item.status === 'canceled'">
      <div class="text-[var(--status-error-text)]">{{ t('batch.statusCanceled') }}</div>
    </template>

    <template v-else-if="item.status === 'unfinished'">
      <div class="text-[var(--status-warn-text)]">{{ t('batch.statusUnfinishedLine') }}</div>
      <div v-if="sentAt" class="text-base text-dim">{{ sentAt }}</div>
    </template>

    <template v-else-if="item.status === 'success'">
      <div class="text-[var(--status-success-text)]">
        {{
          item.dsoIds.length
            ? t('batch.statusObjects', { how: placedText, count: String(item.dsoIds.length) })
            : placedText
        }}
      </div>
    </template>

    <template v-else>
      <div class="text-[var(--status-info-text)]">
        {{ item.saveState === 'new' ? t('batch.chipToSolve') : t('batch.statusSavedUnplaced') }}
      </div>
    </template>

    <!-- Where the saving stands, once the photo is placed or saved -->
    <div v-if="item.saveState === 'saving'" class="flex items-center gap-4 text-secondary">
      <span class="auto-solve-spinner"></span>
      <span>{{ t('batch.statusSaving') }}</span>
    </div>
    <div
      v-else-if="item.saveState === 'modified'"
      class="flex items-center gap-2 text-[var(--status-warn-text)]"
      data-test="status-modified"
    >
      <span class="[&_svg]:w-3 [&_svg]:h-3" v-html="penSvg"></span>
      {{ t('batch.statusModified') }}
    </div>
    <template v-else-if="item.status === 'success'">
      <div v-if="item.saveState === 'new'" class="text-[var(--status-warn-text)]">
        {{ t('batch.statusNotSaved') }}
      </div>
      <div v-else class="text-dim">{{ t('batch.statusSaved') }}</div>
    </template>
    <div v-if="item.saveError" class="text-[var(--status-error-text)]">
      {{ t('batch.saveFailed', { error: item.saveError }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BatchItem, SolverType } from '../../batch-types';
import { t } from '../../i18n';
import { getLang } from '@myastrosky/core/i18n/index';
import { useSettingsStore } from '@myastrosky/app-state/stores/settings';
import closeXSvg from '../../icons/close-x.svg?raw';
import penSvg from '../../icons/pen.svg?raw';

const props = defineProps<{ item: BatchItem }>();
defineEmits<{ cancel: [] }>();

const settingsStore = useSettingsStore();
const maxParallel = computed(() =>
  Math.max(1, parseInt(settingsStore.serverSettings?.MAX_PARALLEL_SOLVES || '4', 10) || 4),
);

const SOLVER_NAMES: Record<SolverType, string> = {
  'solve-field': 'solve-field',
  astap: 'ASTAP',
  astrometry: 'astrometry.net',
};

const isOnline = computed(() => props.item.solver === 'astrometry');

// astrometry.net is slow: past this, the line says the solve goes on online. Local solvers past a minute get a hint.
const ONLINE_SLOW_THRESHOLD_S = 82;
const LOCAL_SLOW_THRESHOLD_S = 60;

const solvingText = computed(() => {
  if (isOnline.value && props.item.elapsedSeconds > ONLINE_SLOW_THRESHOLD_S) {
    return t('modal.solvingOnlineSlow');
  }
  return t('batch.statusSolvingWith', {
    solver: SOLVER_NAMES[props.item.solver],
    seconds: String(props.item.elapsedSeconds),
  });
});

const slowHint = computed(() => {
  if (isOnline.value) {
    return props.item.elapsedSeconds > ONLINE_SLOW_THRESHOLD_S ? t('modal.solveTimeoutHint') : '';
  }
  return props.item.elapsedSeconds > LOCAL_SLOW_THRESHOLD_S ? t('modal.slowSolveHint') : '';
});

const placedText = computed(() => {
  switch (props.item.placedBy) {
    case 'file':
      return t('mobile.gallery.alreadySolved');
    case 'hand':
      return t('mobile.gallery.placedByHand');
    case 'stars':
      return t('mobile.gallery.placedByStars', {
        n: String(props.item.solveCorrespondences?.length ?? 3),
      });
    default:
      return t('mobile.gallery.placedSolved');
  }
});

/** "Envoyée le … à …", in the app's language. */
const sentAt = computed(() => {
  const iso = props.item.online?.sentAt;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const locale = getLang();
  return t('batch.statusSentAt', {
    date: d.toLocaleDateString(locale),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  });
});
</script>
