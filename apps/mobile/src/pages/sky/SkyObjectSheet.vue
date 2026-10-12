<script setup lang="ts">
import { computed, useId } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { twilightWindow } from '@myastrosky/core/astro-time';
import { altitudeAtDeg, maxAltDuringWindow } from '@myastrosky/core/sky-geometry';
import { formatAlt } from '@myastrosky/core/format-utils';
import { formatClock24 } from '@myastrosky/core/targets/format';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import { useSkyTimeStore } from '@myastrosky/app-state/stores/sky-time';
import type { SkySelection } from '../../composables/useSkySelection';
import { useSheetDrag } from '../../composables/useSheetDrag';
import PhoneBadge from '../../components/PhoneBadge.vue';
import PhoneFacts from '../../components/PhoneFacts.vue';
import PhoneIconButton from '../../components/PhoneIconButton.vue';
import AppIcon from '../../components/AppIcon.vue';
import addFrameIcon from '@icons/add-frame.svg?raw';
import addMosaicIcon from '@icons/add-mosaic.svg?raw';
import addToPlanIcon from '@icons/list-plus.svg?raw';
import editIcon from '@icons/pen.svg?raw';
import infoIcon from '../../icons/info.svg?raw';

// The board "Ciel, objet sélectionné": the object picked on the map or in the search, in a sheet over the bottom of the
// map. A deep-sky object has the board's five actions; a star, which the board does not draw, has the desktop's: a
// frame, a mosaic, and its details. The sheet closes by dragging it down from its handle or header, with the handle,
// with a tap on an empty spot of the map and with the back button. The altitude is the object's now in the map's time
// (as the desktop shows it, in date mode with a location only); the transit is when it is highest during the night at
// the location.
const props = defineProps<{ selection: Exclude<SkySelection, { kind: 'photo' }> }>();
const emit = defineEmits<{ close: [] }>();
const titleId = useId();
const time = useSkyTimeStore();

const shown = computed(() => {
  const s = props.selection;
  if (s.kind === 'dso') {
    const d = s.dso;
    return {
      title: d.displayName || d.catalogs[0] || d.id,
      // Under a name the designation; without one the title is the designation.
      designation: d.displayName ? d.catalogs[0] || d.id : undefined,
      typeLabel: t(`dso.types.${d.type}`),
      constellation: d.constellation,
      ra: d.ra,
      dec: d.dec,
      magnitude: d.mag === null ? null : d.mag.toFixed(1),
    };
  }
  const star = s.star;
  const named = star.name || null;
  return {
    title:
      named ||
      (star.bayer && star.constellation ? `${star.bayer} ${star.constellation}` : null) ||
      (star.flam && star.constellation ? `${star.flam} ${star.constellation}` : null) ||
      `HIP ${star.hip}`,
    designation: named
      ? star.bayer && star.constellation
        ? `${star.bayer} ${star.constellation}`
        : star.desig && star.constellation
          ? `${star.desig} ${star.constellation}`
          : undefined
      : undefined,
    // A star has no type: its multiplicity takes the badge when it has one.
    typeLabel: star.multiplicity ? formatMultiplicity(star.multiplicity, t) : undefined,
    constellation: star.constellation,
    ra: star.ra,
    dec: star.dec,
    magnitude: star.mag.toFixed(2),
  };
});

const located = computed(() => time.lat !== null && time.lon !== null);
const facts = computed(() => {
  const { ra, dec, magnitude } = shown.value;
  const out: { label: string; value: string }[] = [];
  if (time.mode === 'date' && located.value) {
    const alt = altitudeAtDeg(ra, dec, time.lat!, time.lon!, time.simDate);
    out.push({ label: t('dso.altitude'), value: formatAlt(alt) });
  }
  if (located.value) {
    const night = twilightWindow(time.simDate, time.lat!, time.lon!);
    if (night) {
      const best = maxAltDuringWindow(ra, dec, time.lat!, time.lon!, night.start, night.end, 10);
      out.push({ label: t('targets.results.bestTime'), value: formatClock24(best.atDate) });
    }
  }
  if (magnitude !== null) out.push({ label: t('stars.magnitude'), value: magnitude });
  return out;
});

const drag = useSheetDrag(() => emit('close'));
</script>

<template>
  <section class="mob-sheet mob-sheet--auto mob-map-sheet" :aria-labelledby="titleId">
    <div class="mob-sheet-drag" v-on="drag">
      <button
        type="button"
        class="mob-sheet-grab"
        :aria-label="t('mobile.sky.closeSheet')"
        @click="emit('close')"
      >
        <span class="mob-sheet-handle" />
      </button>
      <div class="mob-sheet-header">
        <h2 :id="titleId" class="mob-sheet-title m-title">{{ shown.title }}</h2>
        <div class="mob-meta m-secondary">
          <span v-if="shown.designation">{{ shown.designation }}</span>
          <PhoneBadge v-if="shown.typeLabel" kind="type">{{ shown.typeLabel }}</PhoneBadge>
          <PhoneBadge v-if="shown.constellation" kind="const">{{
            shown.constellation.toUpperCase()
          }}</PhoneBadge>
        </div>
      </div>
    </div>
    <PhoneFacts :facts="facts" :columns="facts.length === 3 ? 3 : 2" />
    <!-- The screens behind these actions (frames, mosaics, plan picker, edit, details) have no board yet. -->
    <div
      class="mob-icon-row"
      :class="{ 'mob-icon-row--start': selection.kind !== 'dso' }"
      role="group"
      :aria-label="t('mobile.sky.objectActions')"
    >
      <PhoneIconButton waiting :label="t('fovOverlay.addFrame')"
        ><AppIcon :svg="addFrameIcon"
      /></PhoneIconButton>
      <PhoneIconButton waiting :label="t('fovOverlay.addMosaic')"
        ><AppIcon :svg="addMosaicIcon"
      /></PhoneIconButton>
      <template v-if="selection.kind === 'dso'">
        <PhoneIconButton waiting :label="t('targets.plan.pickerTitle')"
          ><AppIcon :svg="addToPlanIcon"
        /></PhoneIconButton>
        <PhoneIconButton waiting :label="t('dso.edit')"
          ><AppIcon :svg="editIcon"
        /></PhoneIconButton>
      </template>
      <PhoneIconButton waiting :label="t('mobile.sky.details')"
        ><AppIcon :svg="infoIcon"
      /></PhoneIconButton>
    </div>
  </section>
</template>
