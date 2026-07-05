<template>
  <BaseModal
    size="sheet"
    :title="t('targets.findTargets')"
    body-class="p-8 flex-col"
    @close="close"
  >
    <div ref="mountEl" class="w-full"></div>
  </BaseModal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BaseModal from '../base/BaseModal.vue';
import { t } from '../../i18n';
import { useUiStore } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';

const uiStore = useUiStore();
const canvasStore = useCanvasStore();
const mountEl = ref<HTMLDivElement>();

function close(): void {
  uiStore.closeTargetsOverlay();
  // Picks made in the overlay mutate the plans store directly, but the Plans
  // view is a separate persistent DOM tree that only rebuilds on `show()` — it
  // has no live subscription to plan entries. Re-show it now (cheap, and only
  // when it's the visible view) so newly added targets appear immediately
  // instead of waiting for the next tab switch.
  if (uiStore.currentViewMode === 'plans') {
    canvasStore.targetsView?.show();
  }
}

// The recommend surface (gear/location/date/filters + results) is built once by
// TargetsView and never destroyed — mounting it here just reparents the same
// persistent DOM node, so filters/results survive this component unmounting on
// close and remounting on the next "Find targets" open.
onMounted(() => {
  const el = canvasStore.targetsView?.getRecommendElement();
  if (el && mountEl.value) mountEl.value.appendChild(el);
});
</script>
