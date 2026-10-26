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
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import PhoneButton from '../../components/PhoneButton.vue';
import SkyCheckSheet from '../sky/SkyCheckSheet.vue';
import { dsoCatalogOptions } from '../../catalog-options';
import caretIcon from '../../icons/chevron-down.svg?raw';
import galaxyIcon from '@icons/dso-galaxy.svg?raw';
import poiIcon from '@icons/poi-comet.svg?raw';
import AppIcon from '../../components/AppIcon.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Photo, informations": the first object of the photo with its type and constellation, what is known of the
// photo, read only (only the facts it has; the sheet is at most a third of the screen in portrait and its body scrolls),
// and its actions: showing it on the map, editing its information, drawing its objects and its points of interest over
// it (board "Photo, objets affichés": two toggles, as the desktop's photo detail; objects need a photo placed on the
// sky, points of interest a position; the "Catalogues" field, while objects are drawn, chooses which) and deleting it.
const props = defineProps<{
  open: boolean;
  photo: Photo;
  canShowObjects?: boolean;
  canShowPois?: boolean;
}>();
const objects = defineModel<boolean>('objects', { default: false });
const pois = defineModel<boolean>('pois', { default: false });
const catalogs = defineModel<string[]>('catalogs', { default: () => [] });
const catalogsOpen = ref(false);
const catalogOptions = dsoCatalogOptions();
const emit = defineEmits<{
  'update:open': [open: boolean];
  map: [];
  edit: [];
  removed: [];
}>();
const { confirm } = useConfirm();
const { showError } = useErrorToast();

const object = computed(() => {
  // The photo's main object: its most important one (Messier, NGC, IC, …).
  const id = sortDsoIdsByImportance(props.photo.dsoIds ?? [])[0];
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
    <PhotoFacts :photo="photo" file-name objects />
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
    <!-- The sheet stops above this row before it shows everything. -->
    <div
      class="mob-icon-row"
      role="group"
      :aria-label="t('mobile.photo.actions')"
      data-sheet-stop="before"
    >
      <PhoneIconButton :label="t('gallery.showOnMap')" @click="emit('map')">
        <AppIcon :svg="mapPinIcon" />
      </PhoneIconButton>
      <PhoneIconButton :label="t('gallery.editMetadata')" @click="emit('edit')"
        ><AppIcon :svg="penIcon"
      /></PhoneIconButton>
      <PhoneIconButton
        :disabled="!canShowObjects"
        :pressed="objects"
        :label="t('gallery.showDsos')"
        @click="objects = !objects"
        ><AppIcon :svg="galaxyIcon"
      /></PhoneIconButton>
      <PhoneIconButton
        :disabled="!canShowPois"
        :pressed="pois"
        :label="t('gallery.showPois')"
        @click="pois = !pois"
        ><AppIcon :svg="poiIcon"
      /></PhoneIconButton>
      <PhoneIconButton danger :label="t('photos.delete')" @click="remove">
        <AppIcon :svg="trashIcon" />
      </PhoneIconButton>
    </div>
    <SkyCheckSheet
      v-model:open="catalogsOpen"
      :title="t('gallery.filterCatalogs')"
      :options="catalogOptions"
      v-model:selected="catalogs"
    />
  </PhoneSheet>
</template>
