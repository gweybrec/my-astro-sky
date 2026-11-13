<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import {
  DSO_CATALOGS_ALL,
  getDSOById,
  sortDsoIdsByImportance,
} from '@myastrosky/core/catalog/dso-registry';
import type { Photo } from '@myastrosky/core/types';
import { deletePhotoAPI } from '@myastrosky/app-state/api';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneBadge from '../../components/PhoneBadge.vue';
import PhotoFacts from '../../components/PhotoFacts.vue';
import PhoneChipPager from '../../components/PhoneChipPager.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneHelper from '../../components/PhoneHelper.vue';
import SkyCheckSheet from '../sky/SkyCheckSheet.vue';
import { dsoCatalogOptions } from '../../catalog-options';
import caretIcon from '../../icons/chevron-down.svg?raw';
import AppIcon from '../../components/AppIcon.vue';

// The board "Photo, informations": the first object of the photo with its type and constellation, all its objects as
// chips that only show them (`PhoneChipPager`, as the map's photo sheet, without a tap), what is known of the photo,
// read only (only the facts it has; the sheet is at most a third of the screen in portrait and its body scrolls),
// and its actions: reading a WCS file into its information, editing it and deleting it. While its objects are drawn
// over the photo (board "Photo, objets affichés"; the toggle is among the photo's buttons), the "Catalogues" field
// chooses which.
const props = defineProps<{
  open: boolean;
  photo: Photo;
  objects?: boolean;
  wcsLoading?: boolean;
}>();
const catalogs = defineModel<string[]>('catalogs', { default: () => [] });
const catalogsOpen = ref(false);
const catalogOptions = dsoCatalogOptions();
const emit = defineEmits<{
  'update:open': [open: boolean];
  edit: [];
  wcs: [];
  removed: [];
}>();
const { confirm } = useConfirm();
// A visited sky's photo (board "Photo d'un ciel visité"): its author first among its facts, and nothing that
// changes it.
const visited = computed(() => !!props.photo.sharedSkyId);
const { showError } = useErrorToast();

// The photo's objects, the most important first (Messier, NGC, IC, …).
const ids = computed(() => sortDsoIdsByImportance(props.photo.dsoIds ?? []));
const object = computed(() => {
  // The photo's main object: its most important one.
  const id = ids.value[0];
  const dso = id ? getDSOById(id) : undefined;
  if (!dso) return null;
  return {
    title: dso.displayName || dso.catalogs[0] || dso.id,
    // Under a name the designation; without one the title is the designation.
    designation: dso.displayName ? dso.catalogs[0] || dso.id : undefined,
    typeLabel: t(`dso.types.${dso.type}`),
    constellation: dso.constellation,
  };
});

async function remove() {
  const ok = await confirm({
    title: t('photos.deleteConfirmTitle'),
    message: t('photos.deleteConfirmMessage', { name: props.photo.originalName }),
    confirmLabel: t('photos.deleteConfirmAction'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await deletePhotoAPI(props.photo.id);
  } catch (error) {
    await showError(error);
    return;
  }
  emit('update:open', false);
  emit('removed');
}
</script>

<template>
  <PhoneSheet
    :open="open"
    tall
    third
    :title="object?.title ?? photo.originalName"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="object" #header-extra>
      <div class="mob-meta m-secondary">
        <span v-if="object.designation">{{ object.designation }}</span>
        <PhoneBadge kind="type">{{ object.typeLabel }}</PhoneBadge>
        <PhoneBadge v-if="object.constellation" kind="const">{{
          object.constellation.toUpperCase()
        }}</PhoneBadge>
      </div>
    </template>
    <PhoneChipPager :ids="ids" :label="t('mobile.sky.photoObjects')" still />
    <PhotoFacts :photo="photo" file-name />
    <div v-if="objects" class="mob-form-row mob-form-row--field">
      <PhoneButton
        variant="field"
        block
        text-style="body"
        :aria-label="
          t('mobile.targets.countAria', {
            label: t('gallery.filterCatalogs'),
            n: catalogs.length,
            total: DSO_CATALOGS_ALL.length,
          })
        "
        @click="catalogsOpen = true"
      >
        <span class="mob-btn-key">{{ t('gallery.filterCatalogs') }}</span>
        <span class="mob-btn-value mob-btn-value--swatch">{{
          t('mobile.targets.countOf', { n: catalogs.length, total: DSO_CATALOGS_ALL.length })
        }}</span>
        <span class="mob-btn-caret" aria-hidden="true"><AppIcon :svg="caretIcon" /></span>
      </PhoneButton>
    </div>
    <!-- The sheet stops above these buttons before it shows everything. -->
    <div
      v-if="!visited"
      class="mob-photo-actions"
      role="group"
      :aria-label="t('mobile.photo.actions')"
      data-sheet-stop="before"
    >
      <div class="mob-form-row">
        <PhoneButton block :disabled="wcsLoading" @click="emit('wcs')">
          {{ wcsLoading ? t('gallery.loadFromWcsLoading') : t('gallery.loadFromWcs') }}
        </PhoneButton>
      </div>
      <div class="mob-btn-row">
        <PhoneButton @click="emit('edit')">{{ t('mobile.photo.edit') }}</PhoneButton>
        <PhoneButton variant="danger" @click="remove">{{ t('photos.delete') }}</PhoneButton>
      </div>
    </div>
    <SkyCheckSheet
      v-model:open="catalogsOpen"
      :title="t('gallery.filterCatalogs')"
      :options="catalogOptions"
      v-model:selected="catalogs"
    />
  </PhoneSheet>
</template>
