<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { getDSOById, sortDsoIdsByImportance } from '@myastrosky/core/catalog/dso-registry';
import { isPhotoSolved } from '@myastrosky/core/photo-identify';
import type { Photo } from '@myastrosky/core/types';
import { deletePhotoAPI } from '@myastrosky/app-state/api';
import { useConfirm } from '../../composables/useConfirm';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneBadge from '../../components/PhoneBadge.vue';
import PhotoFacts from '../../components/PhotoFacts.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import penIcon from '@icons/pen.svg?raw';
import targetIcon from '@icons/target.svg?raw';
import trashIcon from '@icons/trash.svg?raw';

// The board "Photo, informations": the first object of the photo with its type and constellation, what is known of the
// photo, read only (only the facts it has; the sheet is at most a third of the screen in portrait and its body scrolls),
// and its actions: showing it on the map, editing its information, identifying objects
// in it (a photo with a solve only, as the desktop's identifications) and deleting it.
const props = defineProps<{
  open: boolean;
  photo: Photo;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  map: [];
  edit: [];
  identify: [];
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
    <div class="mob-icon-row" role="group" :aria-label="t('mobile.photo.actions')">
      <PhoneIconButton :label="t('gallery.showOnMap')" @click="emit('map')">
        <AppIcon :svg="mapPinIcon" />
      </PhoneIconButton>
      <PhoneIconButton :label="t('gallery.editMetadata')" @click="emit('edit')"
        ><AppIcon :svg="penIcon"
      /></PhoneIconButton>
      <PhoneIconButton
        :disabled="!isPhotoSolved(photo)"
        :label="t('mobile.photo.identify')"
        @click="emit('identify')"
        ><AppIcon :svg="targetIcon"
      /></PhoneIconButton>
      <PhoneIconButton danger :label="t('photos.delete')" @click="remove">
        <AppIcon :svg="trashIcon" />
      </PhoneIconButton>
    </div>
  </PhoneSheet>
</template>
