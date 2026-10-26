<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  NEW_POI_TYPE_COLOR,
  poiTypesDraft,
  poiTypesDraftKey,
  type PoiTypeDraft,
} from '@myastrosky/core/poi';
import { usePoiCategoriesStore } from '@myastrosky/app-state/stores/poi-categories';
import { useBackClose } from '../composables/useBackClose';
import { useConfirm } from '../composables/useConfirm';
import { useErrorToast } from '../composables/useErrorToast';
import AppIcon from '../components/AppIcon.vue';
import PhoneBackButton from '../components/PhoneBackButton.vue';
import PhoneButton from '../components/PhoneButton.vue';
import PhoneColorButton from '../components/PhoneColorButton.vue';
import PhoneField from '../components/PhoneField.vue';
import PhoneFooter from '../components/PhoneFooter.vue';
import PhoneHelper from '../components/PhoneHelper.vue';
import PhoneIconButton from '../components/PhoneIconButton.vue';
import PhoneInfoButton from '../components/PhoneInfoButton.vue';
import PhoneSectionHeader from '../components/PhoneSectionHeader.vue';
import PhoneTopBar from '../components/PhoneTopBar.vue';
import plusIcon from '@icons/plus.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Types de points d'intérêt", as the desktop's PoiTypesModal: the shared list of the types, each with its
// colour (the phone's colour picker) and its name, removed with the bin; a new one is added under them. Nothing is
// saved before Enregistrer, and leaving with changes asks first. Deleting a type keeps its points of interest on the
// photos, without a type (the explanation behind the "i").
const router = useRouter();
const store = usePoiCategoriesStore();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const draft = ref<PoiTypeDraft[]>([]);
const original = ref('');
const newName = ref('');
const newColor = ref(NEW_POI_TYPE_COLOR);
const saving = ref(false);
let tmp = 0;
/** The desktop's "+ Ajouter un type" starts with a "+" that the board draws as an icon. */
const withoutPlus = (text: string) => text.replace(/^\+\s*/, '');
/** The page is being left on purpose (saved, or the changes given up): nothing asks again. */
let leaving = false;

onMounted(async () => {
  await store.ensureLoaded();
  draft.value = poiTypesDraft(store.categories);
  original.value = poiTypesDraftKey(draft.value);
});

const dirty = computed(() => poiTypesDraftKey(draft.value) !== original.value);

function addType() {
  const name = newName.value.trim();
  if (!name) return;
  draft.value.push({ id: `tmp-${++tmp}`, name, color: newColor.value, isNew: true });
  newName.value = '';
}

function goBack() {
  leaving = true;
  if (window.history.state?.back) router.back();
  else void router.replace('/tabs/gallery');
}

/** As the desktop: leaving with changes that are not saved asks first. */
async function mayLeave(): Promise<boolean> {
  if (leaving || !dirty.value) return true;
  return confirm({
    title: t('poi.typesTitle'),
    message: t('gallery.unsavedChanges'),
    confirmLabel: t('gallery.closeWithoutSaving'),
    destructive: true,
  });
}

async function cancel() {
  if (await mayLeave()) goBack();
}
useBackClose(
  () => !leaving && dirty.value,
  () => void cancel(),
);

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    await store.saveDraft(draft.value);
    goBack();
  } catch (error) {
    void showError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <IonPage>
    <PhoneTopBar>
      <PhoneBackButton fallback="/tabs/gallery" :before="mayLeave" />
      <h1 class="mob-topbar-title mob-topbar-title--grow m-title">{{ t('poi.typesTitle') }}</h1>
      <PhoneInfoButton :title="t('poi.typesTitle')" :message="t('poi.typesHint')" />
    </PhoneTopBar>
    <IonContent :scroll-y="false">
      <div class="mob-scroll mob-page-fill mob-page-column mob-page-safe mob-poi-types">
        <PhoneHelper v-if="draft.length === 0">{{ t('poi.noTypes') }}</PhoneHelper>
        <div v-for="(type, index) in draft" :key="type.id" class="mob-type-row">
          <PhoneColorButton
            v-model="type.color"
            :label="t('mobile.identify.typeColor', { name: type.name })"
          />
          <PhoneField
            v-model="type.name"
            bare
            :aria-label="t('mobile.identify.typeName', { name: type.name })"
          />
          <PhoneIconButton
            danger
            :label="t('mobile.identify.deleteType', { name: type.name })"
            @click="draft.splice(index, 1)"
          >
            <AppIcon :svg="trashIcon" />
          </PhoneIconButton>
        </div>

        <PhoneSectionHeader>{{ withoutPlus(t('poi.addType')) }}</PhoneSectionHeader>
        <div class="mob-type-row">
          <PhoneColorButton v-model="newColor" :label="t('mobile.identify.newTypeColor')" />
          <PhoneField
            v-model="newName"
            bare
            :placeholder="t('poi.newTypePlaceholder')"
            :aria-label="t('mobile.identify.newTypeName')"
            @keydown.enter.prevent="addType"
          />
          <PhoneButton icon :aria-label="withoutPlus(t('poi.addType'))" @click="addType">
            <AppIcon :svg="plusIcon" />
          </PhoneButton>
        </div>
      </div>
    </IonContent>
    <PhoneFooter>
      <PhoneButton size="lg" @click="cancel">{{ t('modal.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="saving" @click="save">
        {{ t('gallery.saveMetadata') }}
      </PhoneButton>
    </PhoneFooter>
  </IonPage>
</template>
