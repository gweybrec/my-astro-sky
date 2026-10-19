<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { reportError } from '@myastrosky/core/platform/error-hook';
import { DEFAULT_REGION_COLOR } from '@myastrosky/core/domain/regions';
import type { AltAzPoint } from '@myastrosky/core/sky-map-types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import { useSkyRegionsStore } from '@myastrosky/app-state/stores/sky-regions';
import { useErrorToast } from '../../composables/useErrorToast';
import PhoneButton from '../../components/PhoneButton.vue';
import PhoneColorButton from '../../components/PhoneColorButton.vue';
import PhoneField from '../../components/PhoneField.vue';
import { useLocalSkyWhileMounted } from './local-sky';

// The board "Dessiner une région", as the desktop's region drawing does it (`openDrawRegionFlow`): the map in local sky,
// one finger draws a closed outline (kept in altitude and azimuth), two fingers move the map. On the desktop the name and
// colour are asked once the mouse is released; here they are under the map from the start, and the outline drawn stays
// shown in its colour until another one replaces it, Effacer le tracé removes it, or Terminer saves it.
const props = defineProps<{ map: SkyMap; mapEl: HTMLElement }>();
const emit = defineEmits<{ cancel: []; saved: [] }>();

const store = useSkyRegionsStore();
const { showError } = useErrorToast();

const name = ref('');
const color = ref(DEFAULT_REGION_COLOR);
const points = shallowRef<AltAzPoint[]>([]);
const saving = ref(false);
const canSave = computed(
  () => name.value.trim() !== '' && points.value.length > 0 && !saving.value,
);
let ended = false;

function show() {
  props.map.setActiveRegionOverlay(
    points.value.length > 0 ? { color: color.value, points: points.value } : null,
  );
}

// Each stroke ends the map's drawing gesture: it starts again at once for the next one. A stroke too short to be a region
// leaves the previous outline as it was.
function draw() {
  if (ended) return;
  const started = props.map.enterRegionDrawMode(
    (drawn) => {
      points.value = drawn;
      show();
      draw();
    },
    () => {
      show();
      draw();
    },
    // A new stroke hides the outline; a stroke dropped by a second finger (the map moves) shows it again.
    { onPress: () => props.map.setActiveRegionOverlay(null), onAbort: show },
  );
  if (!started) {
    void showError(new Error(t('horizon.error.noLocation')));
    emit('cancel');
  }
}

useLocalSkyWhileMounted(props.map, draw);
watch(color, show);

function clear() {
  points.value = [];
  show();
}

async function finish() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    await store.create(name.value.trim(), color.value, points.value);
    emit('saved');
  } catch (error) {
    reportError('SkyRegionDraw.save', error);
    void showError(new Error(t('targets.skyRegion.saveError')));
  } finally {
    saving.value = false;
  }
}

onBeforeUnmount(() => {
  ended = true;
  props.map.cancelRegionDrawMode();
  props.map.setActiveRegionOverlay(null);
});
</script>

<template>
  <Teleport :to="mapEl">
    <div class="mob-map-hint m-caption">{{ t('mobile.targets.regionDrawHint') }}</div>
  </Teleport>
  <section class="mob-panel mob-scroll" :aria-label="t('targets.skyRegion.label')">
    <PhoneField
      v-model="name"
      :label="t('targets.skyRegion.nameLabel')"
      :placeholder="t('targets.skyRegion.namePlaceholder')"
    />
    <div class="mob-form-row">
      <PhoneColorButton
        v-model="color"
        :label="t('targets.skyRegion.colorLabel')"
        :field="t('targets.skyRegion.colorLabel')"
      />
    </div>
    <div class="mob-form-row">
      <PhoneButton block :disabled="points.length === 0" @click="clear">
        {{ t('mobile.targets.regionClear') }}
      </PhoneButton>
    </div>
    <div class="mob-sheet-footer">
      <PhoneButton size="lg" @click="emit('cancel')">{{ t('modal.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!canSave" @click="finish">
        {{ t('mobile.targets.regionFinish') }}
      </PhoneButton>
    </div>
  </section>
</template>
