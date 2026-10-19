<script setup lang="ts">
import { t } from '@myastrosky/core/i18n/index';
import PhoneRow from '../../components/PhoneRow.vue';
import PhoneSheet from '../../components/PhoneSheet.vue';
import asteroidIcon from '@icons/poi-asteroid.svg?raw';
import cometIcon from '@icons/poi-comet.svg?raw';
import supernovaIcon from '@icons/poi-supernova.svg?raw';

// The board "Photo, choisir une identification": opened by the photo sheet's "Identifier les objets", it takes that
// sheet's place; its back arrow opens the photo sheet again (`back`). A row opens its identification page (`choose`).
export type IdentifyKind = 'asteroid' | 'supernova' | 'comet';

const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ back: []; choose: [kind: IdentifyKind] }>();

const rows: { kind: IdentifyKind; label: string; icon: string }[] = [
  { kind: 'asteroid', label: 'asteroid.menuLabel', icon: asteroidIcon },
  { kind: 'supernova', label: 'supernova.menuLabel', icon: supernovaIcon },
  { kind: 'comet', label: 'comet.menuLabel', icon: cometIcon },
];
</script>

<template>
  <PhoneSheet v-model:open="open" :title="t('mobile.photo.identify')" back @back="emit('back')">
    <PhoneRow
      v-for="row in rows"
      :key="row.kind"
      :title="t(row.label)"
      :lead="row.icon"
      chevron
      button
      @click="emit('choose', row.kind)"
    />
  </PhoneSheet>
</template>
