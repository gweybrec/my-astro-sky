<template>
  <div class="flex gap-2 mt-4">
    <button
      class="btn-icon flex-1 flex items-center justify-center"
      :title="t('dso.edit')"
      :aria-label="t('dso.edit')"
      @click.stop="$emit('edit')"
      v-html="penSvg"
    ></button>
    <button
      ref="planBtnRef"
      class="btn-icon flex-1 flex items-center justify-center"
      :class="{ 'bg-[var(--accent-fill-sm)]': inAnyPlan }"
      :title="t('targets.plan.addToPlan')"
      :aria-label="t('targets.plan.addToPlan')"
      @click.stop="pickerOpen = !pickerOpen"
      v-html="listPlusSvg"
    ></button>

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
import { ref, computed, watch, onMounted } from 'vue';
import { t } from '../../i18n';
import type { DSO } from '../../types';
import { usePlansStore } from '../../stores/plans';
import { useUiStore } from '../../stores/ui';
import DropdownPanel from '../base/DropdownPanel.vue';
import penSvg from '../../icons/pen.svg?raw';
import listPlusSvg from '../../icons/list-plus.svg?raw';

// `pinsTooltip` is set when these actions live inside the floating sky tooltip:
// while the plan picker (teleported to <body>) is open, the tooltip must not
// auto-hide as the cursor leaves it for the picker.
const props = defineProps<{ dso: DSO; pinsTooltip?: boolean }>();
defineEmits<{ edit: [] }>();

const plansStore = usePlansStore();
const uiStore = useUiStore();
const pickerOpen = ref(false);
const planBtnRef = ref<HTMLButtonElement>();
const inAnyPlan = computed(() => plansStore.plansContaining(props.dso.id).length > 0);

onMounted(() => { plansStore.ensureLoaded(); });

watch(pickerOpen, (open) => {
  if (props.pinsTooltip) uiStore.setSkyTooltipPinned(open);
});

async function toggle(planId: string) {
  await plansStore.toggleEntry(planId, props.dso.id);
}

async function newPlan() {
  const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const id = await plansStore.createPlan(t('targets.plan.defaultName', { date }));
  if (id) await plansStore.addEntry(id, props.dso.id);
}
</script>
