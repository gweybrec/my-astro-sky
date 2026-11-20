<template>
  <section class="sheet-section">
    <div class="sheet-section-head relative">
      <h4 class="flex-1 min-w-0 m-0">
        <button
          type="button"
          class="sheet-section-toggle"
          :aria-expanded="isOpen"
          data-test="section-toggle"
          @click="toggle"
        >
          <span
            class="inline-flex flex-none transition-transform duration-150 [&>svg]:w-[12px] [&>svg]:h-[12px]"
            :class="{ '-rotate-90': !isOpen }"
            v-html="chevronSvg"
          ></span>
          <span class="sheet-section-title">{{ title }}</span>
          <span
            v-if="!isOpen && summary"
            class="min-w-0 truncate normal-case tracking-normal font-normal text-dim"
            data-test="section-summary"
          >
            · {{ summary }}
          </span>
        </button>
      </h4>
      <slot name="actions" :expand="expand" />
    </div>
    <div v-show="isOpen" class="flex flex-col gap-1" data-test="section-body">
      <slot />
    </div>
  </section>
</template>

<script lang="ts">
const STORAGE_KEY = 'gallery-sheet-folded';

/** The sections folded by the viewer, kept in this browser only (a convenience; empty when storage is unavailable). */
function readFolded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writeFolded(folded: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...folded]));
  } catch {
    /* storage unavailable: the choice lasts until the panel closes */
  }
}
</script>

<script setup lang="ts">
import { ref } from 'vue';

const chevronSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * A section of the gallery's photo panel that folds: its title (with a chevron) opens and closes it, its actions
 * (the "+") stay on the right and receive `expand`, so adding to a folded section opens it first. Folded, it shows
 * `summary` beside its title. Each section remembers, by `id`, whether the viewer folded it.
 */
const props = defineProps<{
  id: string;
  title: string;
  summary?: string;
}>();

const isOpen = ref(!readFolded().has(props.id));

function setOpen(open: boolean) {
  isOpen.value = open;
  const folded = readFolded();
  if (open) folded.delete(props.id);
  else folded.add(props.id);
  writeFolded(folded);
}

function toggle() {
  setOpen(!isOpen.value);
}

function expand() {
  if (!isOpen.value) setOpen(true);
}

defineExpose({ expand });
</script>
