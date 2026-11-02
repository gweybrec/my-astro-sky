<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import mapPinIcon from '@icons/map-pin.svg?raw';
import galaxyIcon from '@icons/dso-galaxy.svg?raw';
import poiIcon from '@icons/poi-comet.svg?raw';
import rotateIcon from '@icons/rotate-right-90.svg?raw';
import infoIcon from '../../icons/info.svg?raw';

// The board "Photo, boutons d'affichage": the column the top bar's "Affichage" button opens, under it along the right
// edge, as the map's column of toggles. Showing the photo on the map, drawing its objects (it must be placed on the
// sky) and its points of interest (one needs a position) over it, turning it a quarter, and its information.
defineProps<{
  canShowObjects?: boolean;
  canShowPois?: boolean;
  turning?: boolean;
}>();
const objects = defineModel<boolean>('objects', { default: false });
const pois = defineModel<boolean>('pois', { default: false });
const emit = defineEmits<{ map: []; rotate: []; info: [] }>();
</script>

<template>
  <div
    class="mob-map-ribbon mob-photo-buttons"
    role="group"
    :aria-label="t('mobile.photo.display')"
  >
    <PhoneIconButton float :label="t('gallery.showOnMap')" @click="emit('map')">
      <AppIcon :svg="mapPinIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :disabled="!canShowObjects"
      :pressed="objects"
      :label="t('gallery.showDsos')"
      @click="objects = !objects"
    >
      <AppIcon :svg="galaxyIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :disabled="!canShowPois"
      :pressed="pois"
      :label="t('gallery.showPois')"
      @click="pois = !pois"
    >
      <AppIcon :svg="poiIcon" />
    </PhoneIconButton>
    <PhoneIconButton
      float
      :disabled="turning"
      :label="t('gallery.rotatePhotoRight')"
      @click="emit('rotate')"
    >
      <AppIcon :svg="rotateIcon" />
    </PhoneIconButton>
    <PhoneIconButton float :label="t('mobile.photo.info')" @click="emit('info')">
      <AppIcon :svg="infoIcon" />
    </PhoneIconButton>
  </div>
</template>
