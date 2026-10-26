<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { starDisplayLabel } from '@myastrosky/core/star-identify';
import type { Star } from '@myastrosky/core/types';
import type { SkyMap } from '@myastrosky/render/sky-map';
import PhoneButton from '../../components/PhoneButton.vue';

// The board "Identifier les étoiles, choisir sur la carte", as the desktop's "Carte" button of a point does it
// (`enterPickingMode`): a tap on the map takes the closest star. On the phone the tapped star is marked on the map and
// named under it, and Valider gives it to the point; a tap elsewhere takes another star.
const props = defineProps<{ map: SkyMap; point: number }>();
const emit = defineEmits<{ cancel: []; picked: [star: Star] }>();

const star = shallowRef<Star | null>(null);

onMounted(() => {
  props.map.enterPickingMode((picked) => {
    star.value = picked;
    props.map.setHighlightedStar(picked.hip);
  });
});
onBeforeUnmount(() => {
  props.map.exitPickingMode();
  props.map.setHighlightedStar(null);
});

function validate() {
  if (star.value) emit('picked', star.value);
}
</script>

<template>
  <section class="mob-panel" :aria-label="t('modal.mapPickTooltip')">
    <div v-if="star" class="mob-row">
      <span class="mob-row-lead m-body-strong">{{ point }}</span>
      <span class="mob-row-body">
        <span class="mob-row-title m-body">{{ starDisplayLabel(star) }}</span>
      </span>
      <span class="mob-row-trail m-secondary">{{
        t('mobile.format.mag', { n: star.mag.toFixed(1) })
      }}</span>
    </div>
    <div class="mob-sheet-footer">
      <PhoneButton size="lg" @click="emit('cancel')">{{ t('modal.cancel') }}</PhoneButton>
      <PhoneButton variant="confirm" size="lg" :disabled="!star" @click="validate">
        {{ t('modal.validate') }}
      </PhoneButton>
    </div>
  </section>
</template>
