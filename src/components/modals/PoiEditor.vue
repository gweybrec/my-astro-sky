<template>
  <div class="metadata-field">
    <label class="metadata-label">{{ t('modal.metadataPoi') }}</label>

    <!-- Existing POIs, as colour-coded chips (× removes inline) -->
    <div class="tag-chips" v-if="pois.length">
      <span
        v-for="(poi, idx) in pois"
        :key="`${poi.categoryId}|${poi.name}|${idx}`"
        class="tag-chip poi-chip"
        :class="{ 'poi-chip--icon': poiTypeIcon(poi.categoryId) }"
        :style="{ '--poi-color': resolveCategory(poi.categoryId, categories).color }"
        :title="resolveCategory(poi.categoryId, categories).name"
      >
        <span
          v-if="poiTypeIcon(poi.categoryId)"
          class="poi-marker"
          v-html="poiTypeIcon(poi.categoryId)"
        ></span>
        {{ poi.name }}
        <button type="button" class="tag-chip-remove" @click="removePoi(idx)">×</button>
      </span>
    </div>

    <div class="flex gap-2 flex-wrap mt-2">
      <button
        type="button"
        class="integration-add-btn"
        :disabled="!isSolved"
        :title="isSolved ? undefined : t('poi.addNeedsSolve')"
        @click="onAddPoi"
      >
        {{ t('poi.addPoi') }}
      </button>
      <button v-if="isSolved" type="button" class="integration-add-btn" @click="onIdentifyAsteroid">
        {{ t('asteroid.menuLabel') }}
      </button>
      <button
        v-if="isSolved"
        type="button"
        class="integration-add-btn"
        @click="onIdentifySupernovae"
      >
        {{ t('supernova.menuLabel') }}
      </button>
      <button v-if="isSolved" type="button" class="integration-add-btn" @click="onIdentifyComets">
        {{ t('comet.menuLabel') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Photo, PointOfInterest } from '../../types';
import { t } from '../../i18n';
import { usePoiCategoriesStore } from '../../stores/poi-categories';
import { resolveCategory } from '../../poi';
import { poiTypeIcon } from '../../poi-icons';
import { computePhotoToProjMatrix } from '../../photo-placement';
import {
  triggerAsteroidModal,
  triggerSupernovaModal,
  triggerCometModal,
  triggerPoiAddModal,
} from '../../ui';
import { showToast } from '../../toast';

// `photo` is optional/nullable because PoiEditor is also used before a photo
// exists yet (a BatchUploadModal card, pre-placement — see BatchCard.vue). Every
// trigger here opens a modal that needs a real, already-solved, server-hosted
// photo (to show the image and turn a click into RA/Dec): until one is
// available the identify buttons don't render, and "+ Ajouter un point
// d'intérêt" stays visible but disabled, with a tooltip saying why.
const props = defineProps<{ pois: PointOfInterest[]; photo?: Photo | null }>();
const emit = defineEmits<{ 'update:pois': [PointOfInterest[]] }>();

const isSolved = computed(() => !!props.photo && computePhotoToProjMatrix(props.photo) !== null);

function onIdentifyAsteroid() {
  if (!props.photo) return;
  triggerAsteroidModal(props.photo, (_photo, pois) => addIdentifiedPois(pois, 'asteroid.added'));
}

// Several asteroids / supernovae / comets can be added at once; one already on
// the photo (same name and type) is skipped rather than duplicated.
function addIdentifiedPois(pois: PointOfInterest[], toastKey: string) {
  const fresh = pois.filter(
    (poi) => !props.pois.some((p) => p.name === poi.name && p.categoryId === poi.categoryId),
  );
  if (!fresh.length) {
    if (pois.length) showToast({ message: t('poi.alreadyListed'), type: 'info', duration: 3000 });
    return;
  }
  emit('update:pois', [...props.pois, ...fresh]);
  showToast({
    message: t(toastKey, { names: fresh.map((p) => p.name).join(', ') }),
    type: 'info',
    duration: 3000,
  });
}

function onIdentifySupernovae() {
  if (!props.photo) return;
  triggerSupernovaModal(props.photo, (_photo, pois) => addIdentifiedPois(pois, 'supernova.added'));
}

function onIdentifyComets() {
  if (!props.photo) return;
  triggerCometModal(props.photo, (_photo, pois) => addIdentifiedPois(pois, 'comet.added'));
}

const categoriesStore = usePoiCategoriesStore();
const categories = computed(() => categoriesStore.categories);

categoriesStore.ensureLoaded();

function onAddPoi() {
  if (!props.photo) return;
  triggerPoiAddModal(props.photo, (_photo, pois) => addIdentifiedPois(pois, 'poi.added'));
}

function removePoi(idx: number) {
  emit(
    'update:pois',
    props.pois.filter((_, i) => i !== idx),
  );
}
</script>
