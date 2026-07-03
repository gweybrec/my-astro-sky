import { createApp } from 'vue';
import { pinia } from './pinia-instance';
import MyAstroSkyApp from './MyAstroSkyApp.vue';
import type { SkyMap } from './sky-map';
import type { PhotoOverlay } from './photo-overlay';
import { reportUnknownRendererError } from './error-reporter';

type ModalName =
  | 'about'
  | 'privacy'
  | 'credits'
  | 'settings'
  | 'export'
  | 'import'
  | 'deleteAll'
  | 'batchUpload'
  | 'solverSettings'
  | 'update'
  | 'shortcuts';

let _appRef: { openModal: (name: ModalName | null) => void } | null = null;

/**
 * Called once from main.ts after setupUI(). Canvas store was already initialized
 * by main.ts via useCanvasStore(pinia).init() before this is called.
 */
export function mountVueApp(_skyMap: SkyMap, _overlay: PhotoOverlay) {
  if (_appRef) return;

  const container = document.getElementById('vue-modal-host');
  if (!container) return;

  const app = createApp(MyAstroSkyApp);
  app.use(pinia);
  app.config.errorHandler = (err, instance, info) => {
    reportUnknownRendererError('vue_component_error', err, {
      info,
      component: (instance as any)?.$options?.name ?? 'unknown',
    });
  };

  _appRef = app.mount(container) as unknown as { openModal: (name: ModalName | null) => void };
}

export function openVueModal(name: ModalName) {
  _appRef?.openModal(name);
}
