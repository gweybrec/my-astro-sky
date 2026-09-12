<template>
  <div class="targets-form-row">
    <div class="targets-label">{{ t('targets.constellationFilter') }}</div>
    <button type="button" class="targets-loc-btn" @click="open = true">
      {{ t('targets.constellationSelect') }}
    </button>
    <span class="targets-const-count">
      {{ selectedCount }} / {{ allConstInfos.length }} {{ t('targets.constellationCountLabel') }}
    </span>
  </div>

  <Teleport to="body" v-if="open">
    <div class="modal-backdrop" @click.self="save">
      <div class="modal targets-const-modal">
        <div class="modal-header">
          <h2>{{ t('targets.constellationModalTitle') }}</h2>
          <button class="modal-close" @click="save">×</button>
        </div>
        <div class="targets-const-modal-body">
          <label class="fov-popup-select-all-row">
            <input
              ref="selectAllRef"
              type="checkbox"
              :checked="allChecked"
              @change="toggleAll(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t('targets.constellationSelectAll') }}</span>
          </label>
          <div class="targets-const-grid">
            <label v-for="c in allConstInfos" :key="c.id" class="targets-type-chip">
              <input
                type="checkbox"
                :checked="draftSet.has(c.id)"
                @change="toggleOne(c.id, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ c.displayName }}</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="targets-generate-btn" @click="save">
            {{ t('targets.constellationDone') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { getConstellationInfos } from '../../star-catalog';
import { useI18n } from '../../composables/useI18n';

// Vue port of the constellation-filter widget from targets-view.ts (button + count
// label + nested modal with a select-all tristate checkbox and a chip grid), reusing
// the same CSS classes (targets-const-modal, targets-const-grid, fov-popup-select-all-row,
// targets-type-chip) so it looks and behaves identically.

const props = defineProps<{
  modelValue: string[] | null; // null = all constellations selected
}>();

const emit = defineEmits<{ 'update:modelValue': [string[] | null] }>();

const { t } = useI18n();

const seen = new Set<string>();
const allConstInfos = getConstellationInfos()
  .filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  })
  .sort((a, b) => a.displayName.localeCompare(b.displayName));

const selectedCount = computed(() => props.modelValue?.length ?? allConstInfos.length);

const open = ref(false);
const draftSet = ref<Set<string>>(new Set());
const selectAllRef = ref<HTMLInputElement>();

const allChecked = computed(() => draftSet.value.size === allConstInfos.length);
const someChecked = computed(() => draftSet.value.size > 0);

watch([allChecked, someChecked], () => {
  if (selectAllRef.value) {
    selectAllRef.value.indeterminate = someChecked.value && !allChecked.value;
  }
});

watch(open, (isOpen) => {
  if (isOpen) {
    draftSet.value = new Set(props.modelValue ?? allConstInfos.map((c) => c.id));
    nextTick(() => {
      if (selectAllRef.value) {
        selectAllRef.value.indeterminate = someChecked.value && !allChecked.value;
      }
    });
  }
});

function toggleOne(id: string, checked: boolean) {
  const next = new Set(draftSet.value);
  if (checked) next.add(id);
  else next.delete(id);
  draftSet.value = next;
}

function toggleAll(checked: boolean) {
  draftSet.value = checked ? new Set(allConstInfos.map((c) => c.id)) : new Set();
}

function save() {
  emit(
    'update:modelValue',
    draftSet.value.size === allConstInfos.length ? null : [...draftSet.value],
  );
  open.value = false;
}
</script>
