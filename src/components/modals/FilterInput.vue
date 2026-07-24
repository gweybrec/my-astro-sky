<template>
  <div class="tag-input-wrap integration-filter-wrap">
    <!-- Badge mode: filter is selected -->
    <template v-if="selectedValue">
      <span class="integration-filter-selected">
        <span
          :class="selectedBadge.class"
          :style="selectedBadge.style"
          :title="selectedTitle"
          class="cursor-pointer"
          @click="enterEditMode"
          >{{ selectedValue }}</span
        >
        <button type="button" class="integration-filter-clear" @mousedown.prevent="clearValue">
          ×
        </button>
      </span>
    </template>

    <!-- Edit mode: text input + dropdown -->
    <template v-else>
      <input
        ref="inputEl"
        type="text"
        class="tag-input integration-input integration-filter-input"
        :placeholder="placeholder"
        :title="tooltip"
        v-model="inputText"
        @input="onInput"
        @focus="
          isEditing = true;
          showSuggestions = true;
        "
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <div v-if="showSuggestions && suggestions.length" class="tag-suggest">
        <div
          v-for="s in suggestions"
          :key="s.label"
          class="tag-suggest-item"
          @mousedown.prevent="selectSuggestion(s.label)"
        >
          <span
            :class="badgeAttrs(s.label, s.color).class"
            :style="badgeAttrs(s.label, s.color).style"
            :title="catalogBadgeTitle(s.label) ?? s.label"
            >{{ s.label }}</span
          >
          <span v-if="s.detail" class="tag-suggest-detail">{{ s.detail }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { filterCandidatesWithCatalog } from '../../autocomplete-utils';
import { filterBadgeAttrs, catalogBadgeTitle } from '../../chip-utils';
import { getVisibleFilterEntries } from '../../gear-catalog';

const badgeAttrs = filterBadgeAttrs;

const props = defineProps<{
  modelValue: string;
  knownFilterMap: Map<string, string>;
  placeholder: string;
  tooltip: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  commit: [value: string];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const selectedValue = ref(props.modelValue || '');
const inputText = ref(props.modelValue || '');
const showSuggestions = ref(false);
const isEditing = ref(false);

// Handle external value updates (e.g., when v-for recycles row by index).
// Skip while the user is actively typing to avoid switching to badge mode mid-input.
watch(
  () => props.modelValue,
  (newVal) => {
    if (isEditing.value) return;
    selectedValue.value = newVal || '';
    if (!selectedValue.value) inputText.value = '';
  },
);

const selectedBadge = computed(() => filterBadgeAttrs(selectedValue.value));
// Full name (+ specs) for a catalog product, since the badge ellipsises in the
// narrow filter column; a plain band name keeps the generic help tooltip.
const selectedTitle = computed(() => catalogBadgeTitle(selectedValue.value) ?? props.tooltip);

const suggestions = computed(() =>
  filterCandidatesWithCatalog(props.knownFilterMap, getVisibleFilterEntries(), inputText.value),
);

function enterEditMode() {
  selectedValue.value = '';
  inputText.value = '';
  showSuggestions.value = true;
  nextTick(() => inputEl.value?.focus());
}

function clearValue() {
  selectedValue.value = '';
  inputText.value = '';
  emit('update:modelValue', '');
  nextTick(() => inputEl.value?.focus());
}

function selectSuggestion(label: string) {
  selectedValue.value = label;
  inputText.value = label;
  showSuggestions.value = false;
  emit('update:modelValue', label);
  emit('commit', label);
}

function onInput() {
  showSuggestions.value = true;
}

function onBlur() {
  isEditing.value = false;
  const trimmed = inputText.value.trim();
  if (trimmed) {
    emit('commit', trimmed);
    selectedValue.value = trimmed;
    emit('update:modelValue', trimmed);
  }
  setTimeout(() => {
    showSuggestions.value = false;
  }, 150);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    showSuggestions.value = false;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const trimmed = inputText.value.trim();
    if (trimmed) {
      selectedValue.value = trimmed;
      emit('update:modelValue', trimmed);
      emit('commit', trimmed);
      showSuggestions.value = false;
    }
  }
}
</script>
