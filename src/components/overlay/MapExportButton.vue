<template>
  <div class="sky-export-control">
    <button
      ref="btnRef"
      type="button"
      class="sky-rotation-btn"
      :title="t('settings.exportView.button')"
      :aria-label="t('settings.exportView.button')"
      @click.stop="open = !open"
      @mouseenter="suppress(true)"
      @mouseleave="suppress(false)"
      @focus="suppress(true)"
      @blur="suppress(false)"
      v-html="exportSvg"
    ></button>
    <DropdownPanel v-model="open" :anchor-el="btnRef" align-right min-width="200px">
      <div class="px-5 pt-3 pb-1 text-micro uppercase text-[var(--text-label)]">
        {{ t('settings.exportView.scopeFull') }}
      </div>
      <button
        type="button"
        class="search-item w-full text-left bg-transparent border-0 cursor-pointer text-[var(--text-primary)]"
        @click="run('full', 'png')"
      >
        {{ t('settings.exportView.png') }}
      </button>
      <button
        type="button"
        class="search-item w-full text-left bg-transparent border-0 cursor-pointer text-[var(--text-primary)]"
        @click="run('full', 'pdf')"
      >
        {{ t('settings.exportView.pdf') }}
      </button>

      <div class="px-5 pt-3 pb-1 text-micro uppercase text-[var(--text-label)]">
        {{ t('settings.exportView.scopeView') }}
      </div>
      <button
        type="button"
        class="search-item w-full text-left bg-transparent border-0 cursor-pointer text-[var(--text-primary)]"
        @click="run('view', 'png')"
      >
        {{ t('settings.exportView.png') }}
      </button>
      <button
        type="button"
        class="search-item w-full text-left bg-transparent border-0 cursor-pointer text-[var(--text-primary)]"
        @click="run('view', 'pdf')"
      >
        {{ t('settings.exportView.pdf') }}
      </button>
    </DropdownPanel>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../../i18n';
import { useUiStore } from '../../stores/ui';
import { useCanvasStore } from '../../stores/canvas';
import { showToast } from '../../toast';
import { downloadBlob } from '../../file-utils';
import { renderMapToBlob, renderMapToPdfBlob, type MapExportScope } from '../../export-render';
import { reportUnknownRendererError } from '../../error-reporter';
import DropdownPanel from '../base/DropdownPanel.vue';
import exportSvg from '../../icons/export.svg?raw';

const uiStore = useUiStore();
const canvasStore = useCanvasStore();

const btnRef = ref<HTMLButtonElement>();
const open = ref(false);

function suppress(v: boolean) {
  uiStore.setForceSuppressTooltip(v);
}

async function run(scope: MapExportScope, format: 'png' | 'pdf') {
  open.value = false;
  const skyMap = canvasStore.skyMap;
  const overlay = canvasStore.overlay;
  if (!skyMap || !overlay) return;

  showToast({ message: t('settings.exportView.rendering'), type: 'info', duration: 2000 });
  try {
    const blob =
      format === 'png'
        ? await renderMapToBlob(skyMap, overlay, scope)
        : await renderMapToPdfBlob(skyMap, overlay, scope);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const part = scope === 'full' ? 'fullmap' : 'view';
    downloadBlob(blob, `myastrosky-${part}-${ts}.${format}`);
    showToast({ message: t('settings.exportView.success'), type: 'info', duration: 2500 });
  } catch (e) {
    reportUnknownRendererError('map_export_failed', e, { scope, format });
    showToast({ message: t('settings.exportView.error'), type: 'error', duration: 4000 });
  }
}
</script>
