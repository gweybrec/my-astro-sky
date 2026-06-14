<template>
  <div class="dso-info-panel">
    <div
      v-if="dso.displayName"
      class="dso-info-name cursor-pointer"
      :title="t('search.recenter')"
      @click="$emit('recenter')"
    >{{ dso.displayName }}</div>
    <table class="dso-info-table">
      <tbody>
        <tr v-if="!isLPN"><td>ID</td><td>{{ dso.catalogs[0] ?? dso.id }}</td></tr>
        <tr><td>{{ t('dso.type') }}</td><td>{{ typeName }}</td></tr>
        <tr><td>{{ t('stars.magnitude') }}</td><td>{{ magStr }}</td></tr>
        <tr><td>{{ t('dso.size') }}</td><td>{{ sizeStr }}</td></tr>
        <tr><td>{{ t('dso.raDec') }}</td><td>{{ raDecStr }}</td></tr>
        <tr v-if="dso.rating !== null"><td>{{ t('targets.ratingFilter') }}</td><td>{{ ratingStr }}</td></tr>
        <tr v-if="dso.difficulty !== null"><td>{{ t('targets.sort.difficulty') }}</td><td>{{ difficultyStr }}</td></tr>
        <tr v-if="dso.emissionLines"><td>{{ t('dso.emissionLines') }}</td><td>{{ dso.emissionLines }}</td></tr>
        <tr v-if="crossRefs.length > 0">
          <td>{{ t('dso.alsoKnownAs') }}</td>
          <td>
            <template v-for="(ref, i) in crossRefs" :key="ref">
              {{ ref }}<br v-if="i < crossRefs.length - 1" />
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="flex gap-2 mt-4">
      <button
        class="btn-icon flex-1 flex items-center justify-center"
        :title="t('dso.edit')"
        :aria-label="t('dso.edit')"
        @click="$emit('edit')"
        v-html="penSvg"
      ></button>
      <button
        ref="planBtnRef"
        class="btn-icon flex-1 flex items-center justify-center"
        :class="{ 'bg-[var(--accent-fill-sm)]': inAnyPlan }"
        :title="t('targets.plan.addToPlan')"
        :aria-label="t('targets.plan.addToPlan')"
        @click.stop="pickerOpen = !pickerOpen"
        v-html="planListSvg"
      ></button>
    </div>

    <DropdownPanel v-model="pickerOpen" :anchor-el="planBtnRef" align-right min-width="220px">
      <div class="px-3 pb-1 text-micro uppercase text-label">{{ t('targets.plan.pickerTitle') }}</div>
      <button
        v-for="plan in plansStore.plans"
        :key="plan.id"
        type="button"
        class="flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]"
        @click="toggle(plan.id)"
      >
        <span class="w-4 shrink-0 text-bright">{{ plansStore.isInPlan(dso.id, plan.id) ? '✓' : '' }}</span>
        <span class="flex-1 truncate">{{ plan.name }}</span>
      </button>
      <div class="border-t border-subtle my-1"></div>
      <button
        type="button"
        class="flex items-center gap-2 w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer text-primary hover:bg-[var(--accent-fill-sm)]"
        @click="newPlan"
      >+ {{ t('targets.plan.newPlan') }}</button>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { t } from '../../i18n';
import type { DSO } from '../../types';
import { getDSOTypeName } from '../../search';
import { formatSize, formatRating, formatDifficulty, formatRA, formatDec } from '../../format-utils';
import { usePlansStore } from '../../stores/plans';
import DropdownPanel from '../base/DropdownPanel.vue';
import penSvg from '../../icons/pen.svg?raw';
import planListSvg from '../../icons/plan-list.svg?raw';

const props = defineProps<{ dso: DSO }>();
defineEmits<{ recenter: []; edit: [] }>();

const plansStore = usePlansStore();
const pickerOpen = ref(false);
const planBtnRef = ref<HTMLButtonElement>();
const inAnyPlan = computed(() => plansStore.plansContaining(props.dso.id).length > 0);

onMounted(() => { plansStore.ensureLoaded(); });

async function toggle(planId: string) {
  await plansStore.toggleEntry(planId, props.dso.id);
}

async function newPlan() {
  const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const id = await plansStore.createPlan(t('targets.plan.defaultName', { date }));
  if (id) await plansStore.addEntry(id, props.dso.id);
}

const isLPN = computed(() => props.dso.id.startsWith('LPN-'));
const typeName = computed(() => getDSOTypeName(props.dso.type));
const magStr = computed(() => props.dso.mag !== null ? props.dso.mag.toFixed(1) : '—');
const sizeStr = computed(() => formatSize(props.dso.majAxis, props.dso.minAxis));
const raDecStr = computed(() => `${formatRA(props.dso.ra)} / ${formatDec(props.dso.dec)}`);
const ratingStr = computed(() => formatRating(props.dso.rating));
const difficultyStr = computed(() => formatDifficulty(props.dso.difficulty));
const crossRefs = computed(() => props.dso.catalogs.slice(1).filter((c: string) => !c.startsWith('LPN-')));
</script>
