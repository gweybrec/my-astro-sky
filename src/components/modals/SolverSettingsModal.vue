<template>
  <BaseModal :title="t('settings.solverSection')" size="wide" body-class="modal-form-body" @close="$emit('close')">

    <!-- ── ASTAP ─────────────────────────────────────────────────────────── -->
    <div class="settings-section-label">{{ t('settings.astapSection') }}</div>
    <div class="settings-field settings-field--tight">
      <div class="settings-field-label-row">
        <label class="settings-field-label">{{ t('settings.astapPath') }}</label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('astapPath', $event)">ℹ</span>
      </div>
      <input type="text" class="settings-field-input" v-model="astapPath" @blur="probeAstap" @keydown.enter="probeAstap">
      <div v-if="isWindows" class="settings-checkbox-row !mt-1 !mb-0">
        <label class="settings-checkbox-label">
          <input type="checkbox" v-model="astapWsl">
          <span>{{ t('settings.useWslAstap') }}</span>
        </label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('astap', $event)">ℹ</span>
      </div>
      <!-- always rendered — prevents layout shift -->
      <div class="probe-status-line">
        <span v-if="astapProbe.state === 'idle'" class="text-dim">{{ t('settings.probeNotConfigured') }}</span>
        <div v-else-if="astapProbe.state === 'loading'" class="flex items-center gap-2">
          <span class="auto-solve-spinner"></span>
          <span class="text-dim">{{ t('settings.probeChecking') }}</span>
        </div>
        <details v-else-if="astapProbe.state === 'ok'">
          <summary class="probe-summary-ok">✓ {{ astapProbe.summary }}</summary>
          <pre class="solve-error-pre probe-pre-ok">{{ astapProbe.detail }}</pre>
        </details>
        <span v-else-if="astapProbe.state === 'error'" class="probe-error">✗ {{ astapProbe.summary }}</span>
      </div>
    </div>

    <hr class="settings-separator">

    <!-- ── solve-field ───────────────────────────────────────────────────── -->
    <div class="settings-section-label">{{ t('settings.solveFieldSection') }}</div>
    <div class="settings-field settings-field--tight">
      <div class="settings-field-label-row">
        <label class="settings-field-label">{{ t('settings.solveFieldPath') }}</label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('sfPath', $event)">ℹ</span>
      </div>
      <input type="text" class="settings-field-input" v-model="sfPath" @blur="probeSolveField" @keydown.enter="probeSolveField">
      <div v-if="isWindows" class="settings-checkbox-row !mt-1 !mb-0">
        <label class="settings-checkbox-label">
          <input type="checkbox" v-model="sfWsl">
          <span>{{ t('settings.useWslSolveField') }}</span>
        </label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('sf', $event)">ℹ</span>
      </div>
      <!-- always rendered — prevents layout shift -->
      <div class="probe-status-line">
        <span v-if="sfProbe.state === 'idle'" class="text-dim">{{ t('settings.probeNotConfigured') }}</span>
        <div v-else-if="sfProbe.state === 'loading'" class="flex items-center gap-2">
          <span class="auto-solve-spinner"></span>
          <span class="text-dim">{{ t('settings.probeChecking') }}</span>
        </div>
        <span v-else-if="sfProbe.state === 'ok'" class="probe-ok">✓ {{ sfProbe.summary }}</span>
        <span v-else-if="sfProbe.state === 'error'" class="probe-error">✗ {{ sfProbe.summary }}</span>
      </div>
    </div>

    <!-- ── Astrometry index directory (part of solve-field section) ──────── -->
    <div class="settings-field">
      <div class="settings-field-label-row">
        <label class="settings-field-label">{{ t('settings.astrometryDataDir') }}</label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('dataDir', $event)">ℹ</span>
      </div>
      <input type="text" class="settings-field-input" v-model="dataDir" @blur="probeDataDir" @keydown.enter="probeDataDir">
      <!-- always rendered — prevents layout shift -->
      <div class="probe-status-line">
        <span v-if="dataDirProbe.state === 'idle'" class="text-dim">{{ t('settings.probeNotConfigured') }}</span>
        <div v-else-if="dataDirProbe.state === 'loading'" class="flex items-center gap-2">
          <span class="auto-solve-spinner"></span>
          <span class="text-dim">{{ t('settings.probeChecking') }}</span>
        </div>
        <details v-else-if="dataDirProbe.state === 'ok'">
          <summary class="probe-summary-ok">✓ {{ dataDirProbe.summary }}</summary>
          <pre class="solve-error-pre probe-pre-ok probe-dir-listing">{{ dataDirProbe.detail }}</pre>
        </details>
        <details v-else-if="dataDirProbe.state === 'error'">
          <summary class="solve-error-summary">✗ {{ dataDirProbe.summary }}</summary>
          <pre class="solve-error-pre">{{ dataDirProbe.detail }}</pre>
        </details>
      </div>
    </div>

    <hr class="settings-separator">

    <!-- ── Astrometry.net ────────────────────────────────────────────────── -->
    <div class="settings-section-label">{{ t('settings.astrometryNetSection') }}</div>
    <div class="settings-field">
      <div class="settings-field-label-row">
        <label class="settings-field-label">{{ t('settings.astrometryApiKey') }}</label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('apiKey', $event)">ℹ</span>
      </div>
      <div class="settings-field-input-row">
        <input type="password" class="settings-field-input" v-model="apiKey" :placeholder="apiKeyPlaceholder">
        <button class="btn-icon btn-icon--danger" :disabled="!apiKeySet" @click="onClearApiKey" :title="t('settings.clearApiKey')">
          <span v-html="trashSvg" />
        </button>
      </div>
      <div class="text-dim-xs" :class="{ hidden: !apiKeySet }">{{ t('settings.astrometryApiKeySet') }}</div>
    </div>

    <hr class="settings-separator">

    <!-- ── Concurrency ───────────────────────────────────────────────────── -->
    <div class="settings-section-label">{{ t('settings.concurrencySection') }}</div>
    <div class="settings-field">
      <div class="settings-field-label-row">
        <label class="settings-field-label">{{ t('settings.maxParallelSolves') }}</label>
        <span class="hints-info-icon" @click.stop="toggleTooltip('maxParallel', $event)">ℹ</span>
      </div>
      <input type="number" class="settings-field-input" v-model="maxParallel" min="1" max="20">
    </div>

    <div class="settings-btn-row">
      <button class="btn-confirm btn-action--full" @click="onSave" :disabled="saving">{{ t('settings.saveSettings') }}</button>
      <span class="settings-save-status" :class="{ hidden: !saveSuccess }">{{ t('settings.settingsSaved') }}</span>
    </div>

  </BaseModal>

  <Teleport to="body">
    <div
      v-if="activeTooltip !== null"
      class="hints-info-tooltip"
      :style="tooltipStyle"
      @click.stop
    >
      <button class="hints-info-close" @click.stop="activeTooltip = null">&times;</button>
      <div v-html="tooltipText"></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../composables/useI18n';
import { showToast } from '../../toast';
import trashSvg from '../../icons/trash.svg?raw';

defineEmits<{ close: [] }>();
const { t } = useI18n();
const settingsStore = useSettingsStore();

const apiKey = ref('');
const astapPath = ref('');
const astapWsl = ref(false);
const sfPath = ref('');
const sfWsl = ref(false);
const dataDir = ref('');
const maxParallel = ref('4');
const saving = ref(false);
const saveSuccess = ref(false);

const apiKeySet = computed(() => !!settingsStore.serverSettings?.apiKeySet);
const isWindows = computed(() => !!settingsStore.serverSettings?.isWindows);
const apiKeyPlaceholder = computed(() =>
  apiKeySet.value ? '••••••••' : t('settings.astrometryApiKeyPlaceholder')
);

// ─── Probe state ──────────────────────────────────────────────────────────────

interface ProbeResult {
  state: 'idle' | 'loading' | 'ok' | 'error';
  summary: string;  // first line / version / "N files" (shown in <summary> or plain)
  detail:  string;  // full output / listing / diagnostics (shown in expanded <pre>)
}

const idle = (): ProbeResult => ({ state: 'idle', summary: '', detail: '' });

const astapProbe    = ref<ProbeResult>(idle());
const sfProbe       = ref<ProbeResult>(idle());
const dataDirProbe  = ref<ProbeResult>(idle());

// Generation counters: only the most recently started probe for each field
// may update state — older in-flight results are discarded.
let astapGen    = 0;
let sfGen       = 0;
let dataDirGen  = 0;

// Guards: skip re-probing on blur if the value hasn't changed (prevents the
// <details> collapsible from being torn down when clicking its <summary>
// moves focus away from the input and fires blur).
let lastProbedAstap   = '';
let lastProbedSf      = '';
let lastProbedDataDir = '';

// When the WSL checkbox changes, clear the guard and re-run the probe so the
// result reflects the new value immediately without requiring another blur/Enter.
watch(astapWsl, () => { lastProbedAstap = ''; probeAstap(); });
watch(sfWsl,   () => { lastProbedSf = ''; lastProbedDataDir = ''; probeSolveField(); probeDataDir(); });

async function probeAstap() {
  const path   = astapPath.value.trim();
  const useWSL = astapWsl.value;
  if (!path) { astapProbe.value = idle(); lastProbedAstap = ''; return; }
  if (path === lastProbedAstap) return;
  lastProbedAstap = path;
  const gen = ++astapGen;
  astapProbe.value = { state: 'loading', summary: '', detail: '' };
  try {
    const res = await fetch('/api/settings/probe-astap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, useWSL }),
    });
    const data = await res.json();
    if (gen !== astapGen) return;
    if (data.ok) {
      const lines = (data.output as string).split('\n');
      astapProbe.value = { state: 'ok', summary: lines[0] ?? '', detail: data.output };
    } else {
      const summary = data.code === -1 ? t('settings.probePathNotFound') : t('settings.astapProbeError');
      astapProbe.value = { state: 'error', summary, detail: [data.stdout, data.stderr].filter(Boolean).join('\n') };
    }
  } catch (err: any) {
    if (gen !== astapGen) return;
    astapProbe.value = { state: 'error', summary: t('settings.astapProbeError'), detail: err.message ?? String(err) };
  }
}

async function probeSolveField() {
  const path   = sfPath.value.trim();
  const useWSL = sfWsl.value;
  if (!path) { sfProbe.value = idle(); lastProbedSf = ''; return; }
  if (path === lastProbedSf) return;
  lastProbedSf = path;
  const gen = ++sfGen;
  sfProbe.value = { state: 'loading', summary: '', detail: '' };
  try {
    const res = await fetch('/api/settings/probe-solve-field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, useWSL }),
    });
    const data = await res.json();
    if (gen !== sfGen) return;
    if (data.ok) {
      sfProbe.value = { state: 'ok', summary: `Version ${data.version}`, detail: '' };
    } else {
      const summary = data.code === -1 ? t('settings.probePathNotFound') : t('settings.sfProbeError');
      sfProbe.value = { state: 'error', summary, detail: [data.stdout, data.stderr].filter(Boolean).join('\n') };
    }
  } catch (err: any) {
    if (gen !== sfGen) return;
    sfProbe.value = { state: 'error', summary: t('settings.sfProbeError'), detail: err.message ?? String(err) };
  }
}

async function probeDataDir() {
  const dir    = dataDir.value.trim();
  const useWSL = sfWsl.value;
  if (!dir) { dataDirProbe.value = idle(); lastProbedDataDir = ''; return; }
  if (dir === lastProbedDataDir) return;
  lastProbedDataDir = dir;
  const gen = ++dataDirGen;
  dataDirProbe.value = { state: 'loading', summary: '', detail: '' };
  try {
    const res = await fetch('/api/settings/probe-data-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, useWSL }),
    });
    const data = await res.json();
    if (gen !== dataDirGen) return;
    if (data.ok) {
      const count = (data.output as string).trim().split('\n').filter((l: string) => l.trim()).length;
      dataDirProbe.value = {
        state: 'ok',
        summary: t('settings.probeFileCount').replace('{n}', String(count)),
        detail: data.output,
      };
    } else {
      const summary = data.code === -1 ? t('settings.probePathNotFound') : t('settings.dataDirProbeError');
      dataDirProbe.value = { state: 'error', summary, detail: data.output || '' };
    }
  } catch (err: any) {
    if (gen !== dataDirGen) return;
    dataDirProbe.value = { state: 'error', summary: t('settings.dataDirProbeError'), detail: err.message ?? String(err) };
  }
}

// ─── Settings load / save ─────────────────────────────────────────────────────

function initFromSettings() {
  const s = settingsStore.serverSettings;
  if (!s) return;
  astapPath.value  = s.ASTAP_PATH;
  sfPath.value     = s.SOLVE_FIELD_PATH;
  dataDir.value    = s.ASTROMETRY_DATA_DIR;
  maxParallel.value = String(Math.max(1, parseInt(s.MAX_PARALLEL_SOLVES || '4', 10) || 4));
  astapWsl.value   = !!s.USE_WSL_FOR_ASTAP;
  sfWsl.value      = !!s.USE_WSL_FOR_SOLVE_FIELD;
}

onMounted(async () => {
  await settingsStore.load();
  initFromSettings();
  // Probe all non-empty fields immediately so the modal opens with live results.
  // Reset guards so the probes aren't skipped if the modal was opened before.
  lastProbedAstap = '';
  lastProbedSf = '';
  lastProbedDataDir = '';
  probeAstap();
  probeSolveField();
  probeDataDir();
});

async function onSave() {
  saving.value = true;
  saveSuccess.value = false;
  try {
    const payload: Parameters<typeof settingsStore.save>[0] = {
      ASTAP_PATH:            astapPath.value,
      SOLVE_FIELD_PATH:      sfPath.value,
      ASTROMETRY_DATA_DIR:   dataDir.value,
      MAX_PARALLEL_SOLVES:   maxParallel.value || '4',
      USE_WSL_FOR_SOLVE_FIELD: sfWsl.value,
      USE_WSL_FOR_ASTAP:     astapWsl.value,
    };
    if (apiKey.value.trim()) payload.apiKey = apiKey.value.trim();
    await settingsStore.save(payload);
    apiKey.value = '';
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
  } finally {
    saving.value = false;
  }
}

async function onClearApiKey() {
  try {
    await settingsStore.clearApiKey();
    apiKey.value = '';
    showToast({ message: t('settings.apiKeyCleared'), type: 'info', duration: 2500 });
  } catch (err: any) {
    showToast({ message: err.message ?? t('settings.importError'), type: 'error' });
  }
}

// ─── Info tooltips ─────────────────────────────────────────────────────────────
type TooltipKey = 'astapPath' | 'sfPath' | 'maxParallel' | 'apiKey' | 'dataDir' | 'astap' | 'sf';

const activeTooltip = ref<TooltipKey | null>(null);
const tooltipStyle  = ref<Record<string, string>>({ position: 'fixed' });
let docClickHandler: ((e: MouseEvent) => void) | null = null;

const tooltipText = computed(() => {
  switch (activeTooltip.value) {
    case 'astapPath':   return t('settings.astapPathTooltip');
    case 'sfPath':      return t('settings.solveFieldPathTooltip');
    case 'maxParallel': return t('settings.maxParallelSolvesTooltip');
    case 'apiKey':      return t('settings.astrometryApiKeyTooltip');
    case 'dataDir':     return t('settings.astrometryDataDirTooltip');
    case 'astap':       return t('settings.wslAstapTooltip');
    case 'sf':          return t('settings.wslSolveFieldTooltip');
    default:            return '';
  }
});

watch(activeTooltip, async (val) => {
  if (docClickHandler) {
    document.removeEventListener('click', docClickHandler);
    docClickHandler = null;
  }
  if (val !== null) {
    await nextTick();
    const tip = document.querySelector('.hints-info-tooltip') as HTMLElement | null;
    if (tip && _lastIconEl) {
      const rect    = _lastIconEl.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      let left = rect.right + 10;
      if (left + tipRect.width > window.innerWidth - 20) left = rect.left - tipRect.width - 10;
      let top  = rect.top;
      if (top + tipRect.height > window.innerHeight - 20) top = window.innerHeight - tipRect.height - 20;
      tooltipStyle.value = { position: 'fixed', left: `${left}px`, top: `${top}px` };
    }
    setTimeout(() => {
      docClickHandler = (e: MouseEvent) => {
        const tip    = document.querySelector('.hints-info-tooltip');
        const target = e.target as HTMLElement;
        if (tip && !tip.contains(target) && !target.closest?.('.hints-info-icon')) {
          activeTooltip.value = null;
        }
      };
      document.addEventListener('click', docClickHandler);
    });
  }
});

let _lastIconEl: HTMLElement | null = null;

function toggleTooltip(key: TooltipKey, event: MouseEvent) {
  if (activeTooltip.value === key) { activeTooltip.value = null; return; }
  _lastIconEl = event.currentTarget as HTMLElement;
  activeTooltip.value = key;
}
</script>

<style scoped>
/* ~7 lines at micro font size (≈14px/line + padding) — overrides solve-error-pre's 180px */
.probe-dir-listing { max-height: 112px; overflow-y: auto; }
/* Green text + border on the shared solve-error-pre dark background */
.probe-pre-ok { color: var(--status-success-text); border-color: var(--status-success-border); }
</style>
