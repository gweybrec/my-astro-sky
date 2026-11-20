<template>
  <div class="sheet-row group" :class="{ 'items-start': open && multiline }" :data-test="testId">
    <!-- Label column (a wide row spans it with its value / editor instead). -->
    <span v-if="!wide && !(open && !popup && wideEditor)" class="sheet-label" :title="label">
      <slot name="label">{{ label }}</slot>
    </span>

    <!-- Reading, or a row whose editor is a pop-up (the date): the value stays shown. -->
    <template v-if="!open || popup">
      <span class="sheet-value" :class="[{ 'col-span-2': wide }, valueClass]"><slot /></span>
      <button
        ref="openBtn"
        type="button"
        :class="open ? 'sheet-icon-btn--on' : 'sheet-icon-btn'"
        :title="editLabel"
        :aria-label="editLabel"
        :aria-expanded="popup ? open : undefined"
        data-test="row-edit"
        @click="open ? cancel() : start()"
        v-html="icon === 'calendar' ? calendarSvg : penSvg"
      ></button>
      <div v-if="open" ref="editorEl" class="contents" @keydown="onKeydown">
        <slot name="editor" :commit="commit" :cancel="cancel" :busy="busy" />
      </div>
    </template>

    <!-- Editing in place: the editor, then ✓ ✕ (and the bin when the field can be removed). -->
    <template v-else>
      <div
        ref="editorEl"
        class="min-w-0 flex items-center gap-2"
        :class="{ 'col-span-2': wide || wideEditor }"
        @keydown="onKeydown"
      >
        <slot name="editor" :commit="commit" :cancel="cancel" :busy="busy" />
      </div>
      <span class="flex items-center gap-1" :class="{ 'self-start': multiline }">
        <button
          type="button"
          class="sheet-ok"
          :disabled="busy"
          :title="t('gallery.sheet.validate')"
          :aria-label="t('gallery.sheet.validate')"
          data-test="row-ok"
          @click="commit"
          v-html="checkSvg"
        ></button>
        <button
          type="button"
          class="sheet-cancel"
          :disabled="busy"
          :title="t('gallery.sheet.cancel')"
          :aria-label="t('gallery.sheet.cancel')"
          data-test="row-cancel"
          @click="cancel"
          v-html="closeSvg"
        ></button>
        <button
          v-if="removable"
          type="button"
          class="sheet-trash"
          :disabled="busy"
          :title="removeLabel"
          :aria-label="removeLabel"
          data-test="row-remove"
          @click="remove"
          v-html="trashSvg"
        ></button>
      </span>
    </template>
  </div>
</template>

<script lang="ts">
/** Counts the rows being edited in a panel (provided by the panel, under this key). */
export interface EditTracker {
  change(delta: 1 | -1): void;
}
export const EDIT_TRACKER_KEY = 'sheetEditTracker';
</script>

<script setup lang="ts">
import { ref, watch, nextTick, inject, onBeforeUnmount } from 'vue';
import { t } from '../../i18n';
import penSvg from '../../icons/pen.svg?raw';
import checkSvg from '../../icons/check.svg?raw';
import closeSvg from '../../icons/close-x.svg?raw';
import trashSvg from '../../icons/trash.svg?raw';
import calendarSvg from '../../icons/calendar.svg?raw';

const props = withDefaults(
  defineProps<{
    label?: string;
    /** Pen (default) or calendar. */
    icon?: 'pen' | 'calendar';
    editLabel?: string;
    /** Saves the edited value; the row closes when it gives true (it stays open, the value kept, otherwise). */
    save: () => boolean | Promise<boolean>;
    /** Opens already in editing (a row just added). */
    startOpen?: boolean;
    /** The editor shows a bin that removes the field. */
    removable?: boolean;
    removeLabel?: string;
    /** No label column: the value and the editor take its width (notes, exposure rows). */
    wide?: boolean;
    /** While edited, the editor takes the label's width too (an exposure row: count × length + filter). */
    wideEditor?: boolean;
    /** The editor is a pop-up under the value (the date picker), with its own buttons. */
    popup?: boolean;
    /** The editor is several lines tall (the notes): ✓ ✕ sit at its top instead of its middle. */
    multiline?: boolean;
    valueClass?: string;
    testId?: string;
  }>(),
  { icon: 'pen', editLabel: undefined, removeLabel: undefined, valueClass: '', testId: undefined },
);

const emit = defineEmits<{
  /** Editing starts: the parent fills the editor with the current value. */
  open: [];
  /** Editing was given up (✕, Esc). */
  cancel: [];
  remove: [];
}>();

const open = ref(!!props.startOpen);
const busy = ref(false);
const editorEl = ref<HTMLElement>();
const openBtn = ref<HTMLButtonElement>();

const tracker = inject<EditTracker | null>(EDIT_TRACKER_KEY, null);
if (open.value) tracker?.change(1);
watch(open, (now) => tracker?.change(now ? 1 : -1));
onBeforeUnmount(() => {
  if (open.value) tracker?.change(-1);
});

function focusEditor() {
  void nextTick(() => {
    editorEl.value?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  });
}
if (open.value) focusEditor();

function start() {
  emit('open');
  open.value = true;
  focusEditor();
}

async function commit() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (await props.save()) open.value = false;
  } finally {
    busy.value = false;
  }
}

function cancel() {
  open.value = false;
  emit('cancel');
}

function remove() {
  emit('remove');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // Closes this editor only, not the photo view behind it.
    e.stopPropagation();
    cancel();
    openBtn.value?.focus();
    return;
  }
  // Enter confirms (in the notes, Ctrl/Cmd+Enter), unless a field inside already used it (a filter suggestion).
  if (e.key !== 'Enter' || e.defaultPrevented) return;
  const inTextarea = (e.target as HTMLElement | null)?.tagName === 'TEXTAREA';
  if (inTextarea && !e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  void commit();
}

defineExpose({ start, cancel, commit });
</script>
