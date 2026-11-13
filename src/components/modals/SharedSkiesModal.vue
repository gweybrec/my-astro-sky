<template>
  <BaseModal
    :title="t('sharedSky.title')"
    size="wide"
    body-class="modal-form-body"
    @close="onClose"
  >
    <div class="settings-io-btns">
      <button class="btn-action" :disabled="busy" @click="emit('share')">
        {{ t('sharedSky.shareBtn') }}
      </button>
      <button class="btn-action" :disabled="busy" @click="fileInput?.click()">
        {{ t('sharedSky.openBtn') }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="SHARED_SKY_ACCEPT"
        @change="onFilePicked"
      />
    </div>

    <!-- A package being read, confirmed or imported -->
    <div v-if="step !== 'idle'" class="privacy-warning-block">
      <template v-if="step === 'reading' || step === 'importing'">
        <p class="text-para">
          {{
            t(step === 'reading' ? 'sharedSky.reading' : 'sharedSky.importing', {
              pct: String(Math.round(progress * 100)),
            })
          }}
        </p>
        <div class="upload-progress">
          <div class="upload-progress-fill" :style="{ width: `${progress * 100}%` }"></div>
        </div>
        <div class="settings-io-btns mt-3">
          <button class="btn-cancel" @click="cancelOpen">{{ t('modal.cancel') }}</button>
        </div>
      </template>
      <template v-else-if="preview">
        <p class="text-para">{{ previewMessage }}</p>
        <p v-if="preview.status !== 'new'" class="text-para">
          {{
            t('sharedSky.previewContent', {
              count: String(preview.photoCount),
              size: formatBytes(preview.bytes),
            })
          }}
        </p>
        <p v-if="preview.freeBytes !== null" class="text-para">
          {{ t('sharedSky.freeSpace', { size: formatBytes(preview.freeBytes) }) }}
        </p>
        <p v-if="lacksRoom" class="status-error">{{ t('serverErrors.NOT_ENOUGH_SPACE') }}</p>
        <div class="settings-io-btns mt-3">
          <button class="btn-cancel" @click="cancelOpen">{{ t('modal.cancel') }}</button>
          <button class="btn-confirm" :disabled="lacksRoom" @click="confirmOpen">
            {{ t(previewKeys.confirm) }}
          </button>
        </div>
      </template>
    </div>

    <hr class="settings-separator" />

    <div class="settings-section-label">{{ t('sharedSky.visitedTitle') }}</div>
    <div v-if="store.skies.length === 0" class="text-muted text-base">
      {{ t('sharedSky.noVisits') }}
    </div>
    <div v-for="sky in store.skies" :key="sky.id" class="flex items-center gap-2 mb-2">
      <!-- The sender's name, as they shared it: never changed here. -->
      <span class="flex-1 min-w-0 text-ellipsis" :title="sky.senderName">{{ sky.senderName }}</span>
      <span class="text-dim-xs flex-none">{{ skyFacts(sky) }}</span>
      <button
        type="button"
        class="integration-row-trash"
        :title="t('photos.delete')"
        :aria-label="t('photos.delete')"
        v-html="trashSvg"
        @click="onDelete(sky)"
      ></button>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * The shared skies window: "Share my sky", "Open a shared sky" (a file is read, what it holds is shown, then it is
 * kept as a visit, with its progress and a cancel), and the visits kept, which can be deleted.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getLang, t } from '../../i18n';
import BaseModal from '../base/BaseModal.vue';
import { useSharedSkiesStore } from '@myastrosky/app-state/stores/shared-skies';
import { showToast } from '../../toast';
import { reportUnknownRendererError } from '../../error-reporter';
import { confirmSharedSkyDelete } from '../../photo-delete-confirm';
import { takeDroppedSharedSky } from '../../shared-sky-drop';
import { formatBytes } from '@myastrosky/core/format-utils';
import type { SharedSky, SharedSkyPreview } from '@myastrosky/core/domain/shared-sky';
import { sharedSkyLacksRoom, sharedSkyPreviewKeys } from '@myastrosky/core/shared-sky-view';
import trashSvg from '../../icons/trash.svg?raw';

const emit = defineEmits<{ close: []; share: [] }>();

/** A package under its own extension, or a ZIP a host or a messaging app renamed: the content decides. */
const SHARED_SKY_ACCEPT = '.myastrosky,.zip';

const store = useSharedSkiesStore();
const fileInput = ref<HTMLInputElement | null>(null);

type Step = 'idle' | 'reading' | 'confirm' | 'importing';
const step = ref<Step>('idle');
const progress = ref(0);
const preview = ref<SharedSkyPreview | null>(null);
let ticket: string | null = null;
let abort: AbortController | null = null;

const busy = computed(() => step.value !== 'idle');
const previewKeys = computed(() => sharedSkyPreviewKeys(preview.value?.status ?? 'new'));
const lacksRoom = computed(() => (preview.value ? sharedSkyLacksRoom(preview.value) : false));

const dateText = (iso: string) => new Date(iso).toLocaleDateString(getLang());

const previewMessage = computed(() => {
  const p = preview.value;
  if (!p) return '';
  return t(previewKeys.value.message, {
    name: p.senderName,
    date: dateText(p.sharedAt),
    kept: p.existing ? dateText(p.existing.sharedAt) : '',
    count: String(p.photoCount),
    size: formatBytes(p.bytes),
  });
});

const skyFacts = (sky: SharedSky) =>
  [
    t('sharedSky.sharedOn', { date: dateText(sky.sharedAt) }),
    t('sharedSky.photoCount', { count: String(sky.photoCount) }),
    formatBytes(sky.bytes),
  ].join(' · ');

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

function reset() {
  step.value = 'idle';
  progress.value = 0;
  preview.value = null;
  ticket = null;
  abort = null;
}

function fail(category: string, err: unknown, fallbackKey: string) {
  if (isAbort(err)) return;
  reportUnknownRendererError(category, err);
  showToast({ message: err instanceof Error ? err.message : t(fallbackKey), type: 'error' });
}

async function readPackage(file: File) {
  if (busy.value) return;
  step.value = 'reading';
  progress.value = 0;
  abort = new AbortController();
  try {
    const inspected = await store.inspect(file, {
      cancel: abort.signal,
      onProgress: (fraction) => (progress.value = fraction),
    });
    ticket = inspected.ticket;
    preview.value = inspected.preview;
    step.value = 'confirm';
  } catch (err) {
    fail('shared_sky_inspect', err, 'errors.openSharedSky');
    reset();
  }
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // The same file can be picked again after a cancel.
  input.value = '';
  if (file) void readPackage(file);
}

async function confirmOpen() {
  if (!ticket) return;
  step.value = 'importing';
  progress.value = 0;
  abort = new AbortController();
  try {
    const sky = await store.open(ticket, {
      cancel: abort.signal,
      onProgress: (fraction) => (progress.value = fraction),
    });
    showToast({ message: t('sharedSky.opened', { name: sky.senderName }), type: 'info' });
  } catch (err) {
    fail('shared_sky_open', err, 'errors.openSharedSky');
  }
  reset();
}

/** Gives up the package being read, confirmed or imported; nothing of it is kept. */
function cancelOpen() {
  const pending = step.value === 'confirm' ? ticket : null;
  abort?.abort();
  if (pending) {
    store.discard(pending).catch((err) => reportUnknownRendererError('shared_sky_discard', err));
  }
  if (step.value !== 'importing') reset();
}

async function onDelete(sky: SharedSky) {
  if (!(await confirmSharedSkyDelete(sky.senderName, sky.photoCount))) return;
  try {
    const freed = await store.remove(sky.id);
    showToast({ message: t('sharedSky.deleted', { size: formatBytes(freed) }), type: 'info' });
  } catch (err) {
    fail('shared_sky_delete', err, 'errors.updateSharedSky');
  }
}

function onClose() {
  if (step.value === 'importing') return;
  if (step.value !== 'idle') cancelOpen();
  emit('close');
}

onMounted(() => {
  void store.load();
  // A package dropped on the window opened this one: it is read at once.
  const dropped = takeDroppedSharedSky();
  if (dropped) void readPackage(dropped);
});

onUnmounted(() => {
  if (step.value === 'reading' || step.value === 'confirm') cancelOpen();
});
</script>
