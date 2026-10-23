<template>
  <Teleport to="body">
    <!-- modal-backdrop (so it suppresses sky tooltips like every other modal); the
         !z override keeps it above the gallery meta-editor overlay (z-index 12000). -->
    <div ref="backdrop" class="modal-backdrop !z-[13000]" @click.self="requestClose">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>{{ t('poi.typesTitle') }}</h2>
          <button class="modal-close" @click="requestClose">&times;</button>
        </div>

        <div class="modal-body modal-form-body--scroll">
          <p class="text-muted text-base mb-3">{{ t('poi.typesHint') }}</p>

          <div v-if="draft.length === 0" class="px-6 py-3 text-muted text-base">
            {{ t('poi.noTypes') }}
          </div>

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
          <button type="button" class="integration-add-btn" @click="addType">
            {{ t('poi.addType') }}
          </button>
        </div>

        <div class="modal-footer">
          <button class="btn-confirm" :disabled="saving" @click="save">
            {{ saving ? '…' : t('gallery.saveMetadata') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { t } from '../../i18n';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { poiTypeIcon } from '../../poi-icons';
import { poiTypesDraft, poiTypesDraftKey, type PoiTypeDraft } from '@myastrosky/core/poi';
import { confirmUnsavedChanges } from '../../photo-delete-confirm';
import { showToast } from '../../toast';
import { isTopmostOverlay } from '../../popup-utils';
import trashSvg from '../../icons/trash.svg?raw';

const emit = defineEmits<{ close: [] }>();

const store = usePoiCategoriesStore();

const draft = ref<PoiTypeDraft[]>([]);
let original = '';
let tmpCounter = 0;

const newName = ref('');
const newColor = ref('#4ea1ff');
const saving = ref(false);

onMounted(async () => {
  await store.ensureLoaded();
  draft.value = poiTypesDraft(store.categories);
  original = poiTypesDraftKey(draft.value);
});

const dirty = computed(() => poiTypesDraftKey(draft.value) !== original);

function addType() {
  const name = newName.value.trim();
  if (!name) return;
  draft.value.push({
    id: `tmp-${++tmpCounter}`,
    name,
    color: newColor.value,
    isNew: true,
  });
  newName.value = '';
}

function removeType(idx: number) {
  draft.value.splice(idx, 1);
}

const backdrop = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && backdrop.value && isTopmostOverlay(backdrop.value)) void requestClose();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

async function requestClose() {
  if (dirty.value && !(await confirmUnsavedChanges())) return;
  emit('close');
}

async function save() {
  saving.value = true;
  try {
    await store.saveDraft(draft.value);
    emit('close');
  } catch (err: any) {
    showToast({ message: err.message, type: 'error', duration: 4000 });
    saving.value = false;
  }
}
</script>
