<template>
  <BaseModal
    :title="t('shortcuts.title')"
    bodyClass="modal-form-body--scroll"
    modalClass="!w-fit !max-w-[90vw]"
    @close="emit('close')"
  >
    <!-- w-0 + min-w-full lets the intro fill (and wrap to) the content width without
         widening the modal — the two columns alone drive the overall width. -->
    <p class="w-0 min-w-full text-dim text-small mb-5">{{ t('shortcuts.intro') }}</p>

    <!-- Two content-sized tables: columns are auto-sized so the keys sit right after the
         labels, and the modal shrink-wraps to them — no dead gap, no side margins. -->
    <div class="flex flex-wrap justify-center gap-x-10 gap-y-6">
      <section v-for="cat in categories" :key="cat">
        <h3 class="text-label text-sub font-medium mb-2">{{ t('shortcuts.category.' + cat) }}</h3>
        <div class="grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1">
          <template v-for="action in actionsByCategory[cat]" :key="action.id">
            <span
              class="flex items-center gap-1 whitespace-nowrap pr-2 text-body"
              :class="conflicts.has(action.id) ? 'text-[var(--status-warn-text)]' : 'text-primary'"
              :title="conflicts.has(action.id) ? t('shortcuts.conflictTooltip') : undefined"
            >
              <!-- Always-present, em-sized slot so the row width never shifts when the
                   warning appears; only its visibility toggles. -->
              <span
                class="w-[1.3em] shrink-0 text-center"
                :class="{ invisible: !conflicts.has(action.id) }"
                aria-hidden="true"
                >⚠</span
              >
              {{ t(action.labelKey) }}
            </span>

            <span class="relative flex items-center gap-1 justify-end">
              <!-- Key caps stay in the layout (just hidden) while capturing so the
                   column width — and thus the modal width — never changes. The prompt
                   is absolutely positioned and contributes nothing to layout. -->
              <kbd
                v-for="key in bindings[action.id]"
                :key="key"
                class="px-3 py-1 rounded-sm border font-mono text-small"
                :class="[
                  conflicts.has(action.id)
                    ? 'border-[var(--status-warn-border)] bg-[var(--status-warn-bg)] text-[var(--status-warn-text)]'
                    : 'border-subtle bg-app text-primary',
                  capturingId === action.id ? 'invisible' : '',
                ]"
                >{{ formatKey(key) }}</kbd
              >
              <span
                v-if="bindings[action.id].length === 0 && capturingId !== action.id"
                class="text-muted text-small"
                >—</span
              >
              <span
                v-if="capturingId === action.id"
                class="absolute right-0 whitespace-nowrap px-3 py-1 rounded-sm border border-focus bg-app text-secondary text-small italic"
                >{{ t('shortcuts.pressAKey') }}</span
              >
            </span>

            <span class="flex items-center gap-1">
              <button
                class="btn-icon"
                :class="{ 'btn-icon--active': capturingId === action.id }"
                :title="t('shortcuts.rebind')"
                @click="startCapture(action.id)"
              >
                ✎
              </button>
              <button
                class="btn-icon"
                :title="t('shortcuts.resetOne')"
                @click="resetOne(action.id)"
              >
                ↺
              </button>
            </span>
          </template>
        </div>
      </section>
    </div>

    <template #footer>
      <button class="btn-cancel" @click="resetAll">{{ t('shortcuts.resetAll') }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { useShortcutsStore } from '../../stores/shortcuts';
import {
  SHORTCUT_ACTIONS,
  formatKey,
  normalizeKey,
  type ShortcutActionId,
  type ShortcutCategory,
} from '../../keyboard-shortcuts';

const emit = defineEmits<{ close: [] }>();

const store = useShortcutsStore();
// Bindings auto-save on every edit (the store persists on each mutation), so there is
// no save button — just the ✕ to close and ↺ to revert.
const { bindings, conflicts } = storeToRefs(store);

const categories: ShortcutCategory[] = ['toggles', 'navigation'];
const actionsByCategory = computed(() => ({
  toggles: SHORTCUT_ACTIONS.filter((a) => a.category === 'toggles'),
  navigation: SHORTCUT_ACTIONS.filter((a) => a.category === 'navigation'),
}));

const capturingId = ref<ShortcutActionId | null>(null);

function onCaptureKey(e: KeyboardEvent) {
  // Capture phase + stopImmediatePropagation so neither BaseModal's Escape handler nor
  // the global shortcut dispatcher react while we're recording a new binding.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'Escape') {
    stopCapture();
    return;
  }
  const key = normalizeKey(e);
  if (!key) return; // ignore bare modifier presses; wait for a real key
  store.setBinding(capturingId.value!, key);
  stopCapture();
}

function startCapture(id: ShortcutActionId) {
  if (capturingId.value) stopCapture();
  capturingId.value = id;
  window.addEventListener('keydown', onCaptureKey, true);
}

function stopCapture() {
  capturingId.value = null;
  window.removeEventListener('keydown', onCaptureKey, true);
}

function resetOne(id: ShortcutActionId) {
  stopCapture(); // pressing reset while editing cancels the "press a key" state
  store.resetOne(id);
}

function resetAll() {
  stopCapture();
  store.resetAll();
}

onUnmounted(stopCapture);
</script>
