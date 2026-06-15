<template>
  <div class="batch-item-status">
    <template v-if="item.status === 'solving'">
      <div class="shared-solve-status-row">
        <span class="auto-solve-spinner"></span>
        <span class="batch-status-text">{{ solvingText }}</span>
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
      <div v-if="slowHint" class="batch-status-dso-line">{{ slowHint }}</div>
      <div v-if="timeoutHint" class="batch-status-dso-line">{{ timeoutHint }}</div>
    </template>

    <template v-else-if="item.status === 'placing'">
      <div class="shared-solve-status-row">
        <span class="auto-solve-spinner"></span>
        <span class="batch-status-text">{{ t('batch.statusPlacing') }}</span>
      </div>
    </template>

    <template v-else-if="item.status === 'success'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text batch-status-success">{{ t('batch.statusSuccess') }}</span>
      </div>
      <div class="batch-status-dso-line">
        {{ item.dsoIds.length > 0 ? t('batch.dsosFound', { count: String(item.dsoIds.length) }) : '' }}
      </div>
      <div v-if="item.uploadError" class="shared-solve-status-row batch-status-upload-error">
        <span>{{ item.uploadError }}</span>
        <button type="button" class="batch-retry-btn" @click="$emit('retry-upload')">{{ t('batch.retryButton') }}</button>
      </div>
    </template>

    <template v-else-if="item.status === 'placed'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text batch-status-success">{{ t('batch.statusPlaced') }}</span>
      </div>
    </template>

    <template v-else-if="item.status === 'failed'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text batch-status-error">✗ {{ item.error || t('batch.statusFailed') }}</span>
        <button type="button" class="batch-retry-btn" @click="$emit('retry')">{{ t('batch.retryButton') }}</button>
      </div>
      <details v-if="item.diagnostics">
        <summary class="solve-error-summary">{{ t('modal.errorDetailsSummary') }}</summary>
        <pre class="solve-error-pre">{{ item.diagnostics }}</pre>
      </details>
    </template>

    <template v-else-if="item.status === 'canceled'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text batch-status-error">{{ t('batch.statusCanceled') }}</span>
        <button type="button" class="batch-retry-btn" @click="$emit('retry')">{{ t('batch.retryButton') }}</button>
      </div>
    </template>

    <template v-else-if="item.status === 'wcs-ready'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text batch-status-wcs">{{ t('batch.statusWcsReady') }}</span>
      </div>
    </template>

    <template v-else-if="item.status === 'waiting'">
      <div class="shared-solve-status-row">
        <span class="batch-status-text">{{ t('batch.statusWaiting', { max: String(maxParallel) }) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BatchItem } from '../../batch-types';
import { t } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import closeXSvg from '../../icons/close-x.svg?raw';

const props = defineProps<{ item: BatchItem }>();
defineEmits<{ cancel: []; retry: []; 'retry-upload': [] }>();

const settingsStore = useSettingsStore();
const maxParallel = computed(() =>
  Math.max(1, parseInt(settingsStore.serverSettings?.MAX_PARALLEL_SOLVES || '4', 10) || 4),
);

// Online (astrometry.net) solves are slow; once past this threshold show the
// "still solving online" + "can take up to 10 minutes" hints the single modal had.
const ONLINE_SLOW_THRESHOLD_S = 82;
// Local solvers (solve-field / ASTAP) past a minute get the generic slow hint.
const LOCAL_SLOW_THRESHOLD_S = 60;

const isOnline = computed(() => props.item.solver === 'astrometry' && props.item.wcsResult == null);

const solvingText = computed(() => {
  if (isOnline.value && props.item.elapsedSeconds > ONLINE_SLOW_THRESHOLD_S) {
    return t('modal.solvingOnlineSlow');
  }
  return t('batch.statusSolving', { seconds: String(props.item.elapsedSeconds) });
});

const slowHint = computed(() => {
  if (isOnline.value) return '';
  return props.item.elapsedSeconds > LOCAL_SLOW_THRESHOLD_S ? t('modal.slowSolveHint') : '';
});

const timeoutHint = computed(() => {
  if (!isOnline.value) return '';
  return props.item.elapsedSeconds > ONLINE_SLOW_THRESHOLD_S ? t('modal.solveTimeoutHint') : '';
});
</script>
