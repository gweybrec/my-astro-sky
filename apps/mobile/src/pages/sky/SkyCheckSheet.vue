<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import PhoneSheet from '../../components/PhoneSheet.vue';
import PhoneCheckRow from '../../components/PhoneCheckRow.vue';

// A choice of several values among a list, in a sheet: "Tous" and one tick box per value, with its line under it
// (`sub`, "2 photos"). With `groups` the values are listed under their group's row (the boards "Ciel, affichage, points
// d'intérêt": a type of point of interest with its colour dot, then its names), whose tick box ticks them all. Each
// change applies at once.
export interface CheckOption {
  value: string;
  label: string;
  sub?: string;
}
export interface CheckGroup {
  id: string;
  label: string;
  color: string;
  options: CheckOption[];
}
const props = defineProps<{
  title: string;
  options: readonly CheckOption[];
  groups?: readonly CheckGroup[];
}>();
const open = defineModel<boolean>('open', { required: true });
const selected = defineModel<string[]>('selected', { required: true });

const chosen = computed(() => new Set(selected.value));
const shown = (options: readonly CheckOption[]) =>
  options.filter((o) => chosen.value.has(o.value)).length;
const state = (options: readonly CheckOption[]) => {
  const n = shown(options);
  return { on: n === options.length && n > 0, some: n > 0 && n < options.length };
};
const all = computed(() => state(props.options));

function setMany(values: string[], on: boolean) {
  const next = new Set(chosen.value);
  for (const v of values) {
    if (on) next.add(v);
    else next.delete(v);
  }
  selected.value = props.options.filter((o) => next.has(o.value)).map((o) => o.value);
}
const setAll = (on: boolean) =>
  setMany(
    props.options.map((o) => o.value),
    on,
  );
</script>

<template>
  <PhoneSheet v-model:open="open" :title="title" tall>
    <PhoneCheckRow
      :title="t('mobile.targets.all')"
      :model-value="all.on"
      :indeterminate="all.some"
      @update:model-value="setAll"
    />
    <template v-if="groups">
      <template v-for="g in groups" :key="g.id">
        <PhoneCheckRow
          :title="g.label"
          :swatch="g.color"
          strong
          :model-value="state(g.options).on"
          :indeterminate="state(g.options).some"
          @update:model-value="
            setMany(
              g.options.map((o) => o.value),
              $event,
            )
          "
        />
        <PhoneCheckRow
          v-for="o in g.options"
          :key="o.value"
          :title="o.label"
          :subs="o.sub ? [o.sub] : []"
          :model-value="chosen.has(o.value)"
          @update:model-value="setMany([o.value], $event)"
        />
      </template>
    </template>
    <template v-else>
      <PhoneCheckRow
        v-for="o in options"
        :key="o.value"
        :title="o.label"
        :subs="o.sub ? [o.sub] : []"
        :model-value="chosen.has(o.value)"
        @update:model-value="setMany([o.value], $event)"
      />
    </template>
  </PhoneSheet>
</template>
