<template>
  <!-- Chips sit ABOVE the input (as in the metadata editor), so adding a label never
       shrinks the input. -->
  <div class="flex flex-col gap-2">
    <div v-if="modelValue.length > 0" class="tag-chips">
      <span v-for="lbl in modelValue" :key="lbl" class="tag-chip label-chip">
        {{ lbl }}
        <button type="button" class="tag-chip-remove" @click="removeLabel(lbl)">×</button>
      </span>
    </div>
    <div class="tag-input-wrap relative w-full">
      <input
        ref="inputEl"
        type="text"
        class="tag-input"
        :class="inputClass"
        :placeholder="placeholder ?? t('modal.metadataLabelsPlaceholder')"
        v-model="input"
        @input="showSuggest = true"
        @focus="showSuggest = true"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>

    <!-- Teleported + anchored to the input: an absolutely positioned panel would be
         clipped by any scrolling ancestor (the batch editor's photo list clips it
         entirely on the bottom rows). attachAnchoredPanel also flips it above when
         there is no room below and hides it once the anchor scrolls out of view. -->
    <Teleport to="body">
      <div v-if="showSuggest && suggestions.length" ref="suggestEl" class="tag-suggest">
        <div
          v-for="suggestion in suggestions"
          :key="suggestion"
          class="tag-suggest-item"
          @mousedown.prevent="selectSuggestion(suggestion)"
        >
          {{ suggestion }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from '../../composables/useI18n';
import { filterLabelCandidates } from '../../autocomplete-utils';
import { attachAnchoredPanel } from '../../popup-utils';

const props = defineProps<{
  modelValue: string[];
  /** Labels already used elsewhere, offered as autocomplete suggestions. */
  known: string[];
  placeholder?: string;
  /** Extra classes for the text input, e.g. to pin its height to a row-mate. */
  inputClass?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [labels: string[]] }>();

const { t } = useI18n();

const input = ref('');
const showSuggest = ref(false);
const inputEl = ref<HTMLInputElement>();
const suggestEl = ref<HTMLElement>();

const suggestions = computed(() =>
  filterLabelCandidates(props.known, props.modelValue, input.value),
);

// Keep the teleported panel glued to the input (and matching its width) for as long
// as it is open; detach when it closes so no listeners leak.
let detachPanel: (() => void) | null = null;

watch([showSuggest, suggestions], async ([open, list]) => {
  detachPanel?.();
  detachPanel = null;
  if (!open || list.length === 0) return;
  await nextTick();
  if (!suggestEl.value || !inputEl.value) return;
  detachPanel = attachAnchoredPanel(suggestEl.value, inputEl.value, {
    gap: 0,
    minWidth: `${inputEl.value.getBoundingClientRect().width}px`,
    // Scrolling the row out of view would otherwise strand the panel mid-screen.
    onAnchorOutOfView: () => {
      showSuggest.value = false;
    },
  });
});

onBeforeUnmount(() => detachPanel?.());

function commit(value: string) {
  const trimmed = value.trim();
  if (!trimmed || props.modelValue.includes(trimmed)) return;
  emit('update:modelValue', [...props.modelValue, trimmed]);
}

function removeLabel(label: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((l) => l !== label),
  );
}

function selectSuggestion(suggestion: string) {
  commit(suggestion);
  input.value = '';
  showSuggest.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    commit(input.value);
    input.value = '';
    showSuggest.value = false;
  } else if (e.key === 'Escape') {
    showSuggest.value = false;
  }
}

// Commit whatever was typed on blur so a value isn't silently lost, then let the
// click on a suggestion (mousedown) land before the list disappears.
function onBlur() {
  commit(input.value);
  input.value = '';
  setTimeout(() => {
    showSuggest.value = false;
  }, 150);
}
</script>
