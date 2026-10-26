<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@myastrosky/core/i18n/index';
import { resolveCategory } from '@myastrosky/core/poi';
import { poiAtPixel } from '@myastrosky/core/photo-identify';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import AppIcon from '../../components/AppIcon.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import PhoneMarker from '../../components/PhoneMarker.vue';
import PhoneRadioSheet from '../../components/PhoneRadioSheet.vue';
import PhoneSectionHeader from '../../components/PhoneSectionHeader.vue';
import type { PhotoPoint } from '../../components/PhonePhotoStage.vue';
import IdentifyFrame from './IdentifyFrame.vue';
import { useIdentifyPage } from './identify-page';
import caretIcon from '../../icons/chevron-down.svg?raw';
import penIcon from '@icons/pen.svg?raw';

// The board "Ajouter un point d'intérêt", as the desktop's PoiAddModal: the point is named, given a type, and placed
// by a tap on the photo; its marker takes the type's colour. The pen beside the type opens the types' page ("Gérer les
// types"), as the desktop's button does.
const router = useRouter();
const categories = usePoiCategoriesStore();
void categories.ensureLoaded();

const { photo, shown, adding, close, add } = useIdentifyPage();

const name = ref('');
const categoryId = ref<string | undefined>(undefined);
const at = ref<PhotoPoint | null>(null);
const typeOpen = ref(false);

// The first type until one is chosen, and again when the chosen one is deleted on the types' page.
watch(
  () => categories.categories,
  (list) => {
    if (!categoryId.value || !list.some((c) => c.id === categoryId.value)) {
      categoryId.value = list[0]?.id;
    }
  },
  { immediate: true },
);

const typeOptions = computed(() =>
  categories.categories.map((c) => ({ value: c.id, label: c.name })),
);
const type = computed(() =>
  categoryId.value ? resolveCategory(categoryId.value, categories.categories) : null,
);
const typeChoice = computed({
  get: () => categoryId.value,
  set: (id: string | undefined) => {
    categoryId.value = id;
    typeOpen.value = false;
  },
});

const canAdd = computed(() => !!name.value.trim() && !!categoryId.value && !!at.value);

function addPoi() {
  if (!shown.value || !at.value || !categoryId.value || !canAdd.value) return;
  const poi = poiAtPixel(shown.value, at.value, name.value.trim(), categoryId.value);
  if (poi) void add([poi], 'poi.added');
}
</script>

<template>
  <IdentifyFrame
    :title="t('poi.addTitle')"
    :info="t('mobile.identify.poiAddIntro')"
    :photo="photo"
    :panel-label="t('mobile.identify.poiPanel')"
    @tap="at = $event"
  >
    <template #markers="{ onScreen }">
      <div
        v-if="at"
        class="mob-identify-anchor"
        :style="{ left: `${onScreen(at).x}px`, top: `${onScreen(at).y}px` }"
      >
        <PhoneMarker
          :label="t('mobile.identify.poiMarker')"
          active
          tint
          :style="{ '--poi-color': type?.color }"
        />
      </div>
    </template>

    <PhoneSectionHeader>{{ t('poi.nameLabel') }}</PhoneSectionHeader>
    <PhoneField
      v-model="name"
      :aria-label="t('poi.nameLabel')"
      :placeholder="t('modal.metadataPoiNamePlaceholder')"
    />
    <div class="mob-add-row mob-identify-type">
      <PhoneButton
        variant="field"
        text-style="body"
        block
        :aria-label="
          t('mobile.format.labelValue', { label: t('poi.typeLabel'), value: type?.name ?? '' })
        "
        @click="typeOpen = true"
      >
        <span class="mob-btn-key">{{ t('poi.typeLabel') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch"
          ><span v-if="type" class="mob-swatch" :style="{ background: type.color }" />{{
            type?.name
          }}</span
        >
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
      <PhoneButton icon :aria-label="t('poi.editTypes')" @click="router.push('/gallery/poi-types')">
        <AppIcon :svg="penIcon" />
      </PhoneButton>
    </div>

    <template #footer>
      <div class="mob-sheet-footer mob-sheet-footer--primary-wide">
        <PhoneButton size="lg" @click="close">{{ t('modal.cancel') }}</PhoneButton>
        <PhoneButton variant="confirm" size="lg" :disabled="!canAdd || adding" @click="addPoi">{{
          t('poi.addConfirm')
        }}</PhoneButton>
      </div>
    </template>

    <PhoneRadioSheet
      v-model:open="typeOpen"
      v-model:value="typeChoice"
      :title="t('poi.typeLabel')"
      :options="typeOptions"
    />
  </IdentifyFrame>
</template>
