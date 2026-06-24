<template>
  <Teleport to="body">
    <!-- z above the gallery meta-editor overlay (z-index 12000) so it's never hidden. -->
    <div
      class="fixed inset-0 flex items-center justify-center bg-[var(--bg-overlay)] z-[13000]"
      @click.self="requestClose"
    >
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>{{ t('poi.typesTitle') }}</h2>
          <button class="modal-close" @click="requestClose">&times;</button>
        </div>

        <div class="modal-body modal-form-body--scroll">
          <p class="text-muted text-base mb-3">{{ t('poi.typesHint') }}</p>

          <div v-if="draft.length === 0" class="px-6 py-3 text-muted text-base">{{ t('poi.noTypes') }}</div>

          <div v-for="(cat, idx) in draft" :key="cat.id" class="flex items-center gap-2 mb-2">
            <span
              v-if="poiTypeIcon(cat.id)"
              class="poi-marker flex-none"
              :style="{ '--poi-color': cat.color }"
              v-html="poiTypeIcon(cat.id)"
            ></span>
            <input
              type="color"
              class="w-8 h-8 flex-none cursor-pointer bg-transparent border-none p-0"
              v-model="cat.color"
              :title="t('poi.colorLabel')"
            />
            <input type="text" class="tag-input flex-1 min-w-0" v-model="cat.name" />
            <button
              type="button"
              class="integration-row-trash"
              :title="t('poi.deleteType')"
              v-html="trashSvg"
              @click="removeType(idx)"
            ></button>
          </div>

          <div class="flex items-center gap-2 mt-4">
            <input
              type="color"
              class="w-8 h-8 flex-none cursor-pointer bg-transparent border-none p-0"
              v-model="newColor"
              :title="t('poi.colorLabel')"
            />
            <input
              type="text"
              class="tag-input flex-1 min-w-0"
              :placeholder="t('poi.newTypePlaceholder')"
              v-model="newName"
              @keydown.enter.prevent="addType"
            />
          </div>
          <button type="button" class="integration-add-btn" @click="addType">{{ t('poi.addType') }}</button>
        </div>

        <div class="modal-footer">
          <button class="btn-confirm" :disabled="saving" @click="save">{{ saving ? '…' : t('gallery.saveMetadata') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { t } from '../../i18n';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { createPoiCategory, updatePoiCategory, deletePoiCategoryAPI } from '../../api';
import { poiTypeIcon } from '../../poi-icons';
import { confirmUnsavedChanges } from '../../photo-delete-confirm';
import { showToast } from '../../toast';
import trashSvg from '../../icons/trash.svg?raw';

const emit = defineEmits<{ close: [] }>();

const store = usePoiCategoriesStore();

interface DraftType { id: string; name: string; color: string; position: number; isNew?: boolean }

const draft = ref<DraftType[]>([]);
let original = '';
let tmpCounter = 0;

const newName = ref('');
const newColor = ref('#4ea1ff');
const saving = ref(false);

function snapshot(list: DraftType[]): string {
  return JSON.stringify(list.map(c => ({ id: c.isNew ? 'new' : c.id, name: c.name.trim(), color: c.color })));
}

onMounted(async () => {
  await store.ensureLoaded();
  draft.value = store.categories.map(c => ({ id: c.id, name: c.name, color: c.color, position: c.position }));
  original = snapshot(draft.value);
});

const dirty = computed(() => snapshot(draft.value) !== original);

function addType() {
  const name = newName.value.trim();
  if (!name) return;
  draft.value.push({ id: `tmp-${++tmpCounter}`, name, color: newColor.value, position: draft.value.length, isNew: true });
  newName.value = '';
}

function removeType(idx: number) {
  draft.value.splice(idx, 1);
}

async function requestClose() {
  if (dirty.value && !(await confirmUnsavedChanges())) return;
  emit('close');
}

async function save() {
  saving.value = true;
  try {
    const existing = store.categories;
    const keptIds = new Set(draft.value.filter(d => !d.isNew).map(d => d.id));
    // Deletions: original types no longer present in the draft.
    for (const c of existing) {
      if (!keptIds.has(c.id)) await deletePoiCategoryAPI(c.id);
    }
    // Creates + updates.
    for (const d of draft.value) {
      const name = d.name.trim();
      if (!name) continue;
      if (d.isNew) {
        await createPoiCategory({ name, color: d.color });
      } else {
        const o = existing.find(c => c.id === d.id);
        if (o && (o.name !== name || o.color !== d.color)) {
          await updatePoiCategory(d.id, { name, color: d.color });
        }
      }
    }
    await store.load();
    emit('close');
  } catch (err: any) {
    showToast({ message: err.message, type: 'error', duration: 4000 });
    saving.value = false;
  }
}
</script>
