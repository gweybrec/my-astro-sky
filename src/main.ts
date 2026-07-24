import { loadCatalog } from './star-catalog';
import { loadDSOCatalog } from './dso-catalog';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { Gallery } from './gallery';
import { TargetsView } from './targets-view';
import { getPhotos, getGearSetups, getLatestVersion } from './api';
import { isUpdateAvailable, DISMISSED_UPDATE_KEY } from './version-check';
import { buildFovFrameSpecs } from './fov-overlay';
import { getHemisphere } from './projection';
import { computeFovTargetScale } from './gear-presets';
import { getFilters } from './gear-catalog';
import { setupUI } from './ui';
import { mountVueApp, openVueModal } from './modal-host';
import { pinia } from './pinia-instance';
import { useCanvasStore } from './stores/canvas';
import { useUiStore } from './stores/ui';
import { usePhotosStore } from './stores/photos';
import { useFovFramesStore } from './stores/fov-frames';
import { usePoiCategoriesStore } from './stores/poi-categories';
import { showToast } from './toast';
import { getLang, t } from './i18n';
import { reportRendererError, reportUnknownRendererError } from './error-reporter';
import { openDSOEditModal } from './dso-editor';
import { loadTheme, applyTheme } from './theme';
import 'virtual:uno.css';
import './style.css';
import './styles/canvas.css';

applyTheme(loadTheme());

window.addEventListener('error', (event) => {
  reportRendererError({
    category: 'renderer_uncaught_error',
    message: event.message || 'Uncaught renderer error',
    stack: event.error?.stack,
    context: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportUnknownRendererError('renderer_unhandled_rejection', reason);
});

async function init() {
  // Set document language and title
  document.documentElement.lang = getLang();
  document.title = t('app.title');

  // Set loading text and button text from translations
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = loadingOverlay?.querySelector('.loading-text');
  if (loadingText) loadingText.textContent = t('app.loading');

  const togglePanel = document.getElementById('toggle-panel');
  if (togglePanel) togglePanel.title = t('display.togglePanel');

  // Load star and DSO catalogs in parallel
  try {
    await Promise.all([loadCatalog(), loadDSOCatalog()]);
  } catch (err: any) {
    reportUnknownRendererError('catalog_load_failure', err);
    // Show error in loading overlay instead of spinner
    if (loadingOverlay) {
      loadingOverlay.innerHTML = `<div class="loading-error">${err.message || t('app.catalogError')}</div>`;
    }
    return;
  }

  // Warm the filter catalog in the background: filter badges resolve their colour
  // synchronously and fall back to the generic token colours until it lands, so
  // this must not block (or fail) the boot sequence.
  void getFilters().catch((err) => reportUnknownRendererError('filter_catalog_load_failed', err));

  // Remove loading overlay
  if (loadingOverlay) {
    loadingOverlay.classList.add('fade-out');
    loadingOverlay.addEventListener('transitionend', () => loadingOverlay.remove());
  }

  // Init sky map
  const canvas = document.getElementById('sky-canvas') as HTMLCanvasElement;
  const skyMap = new SkyMap(canvas);
  const overlayCanvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
  skyMap.setOverlayCanvas(overlayCanvas);
  window.addEventListener('app-theme-changed', () => skyMap.render());

  // Init photo overlay
  const overlayDiv = document.getElementById('photo-layer') as HTMLDivElement;
  const overlay = new PhotoOverlay(overlayDiv, () => skyMap.getView(), skyMap);

  // Init gallery
  const gallery = new Gallery();

  const uiStore = useUiStore(pinia);

  const canvasStore = useCanvasStore(pinia);

  // Init targets view
  const fovStore = useFovFramesStore(pinia);
  const targetsView = new TargetsView(skyMap, async (ra, dec, setupId) => {
    if (setupId) {
      try {
        const setups = await getGearSetups();
        const targetSetup = setups.find((s) => s.id === setupId);
        if (targetSetup) {
          const specs = await buildFovFrameSpecs([{ ...targetSetup, enabled: true }]);
          if (specs.length > 0) {
            const spec = specs[0];
            const view = skyMap.getView();
            const targetScale = computeFovTargetScale(
              spec.wDeg,
              spec.hDeg,
              dec,
              getHemisphere(),
              Math.min(view.width, view.height),
            );
            // Open the target as a free frame pinned to the sky: switches the FOV
            // system to free mode (the rest of the sky reflects it), shows the
            // frame, and opens the frame-manager popup.
            fovStore.addAdhocFrameAtSky(setupId, ra, dec);
            fovStore.setFramesVisible(true);
            uiStore.switchView('skymap');
            skyMap.navigateTo(ra, dec, targetScale);
            fovStore.requestPopupOpen();
            return;
          }
        }
      } catch {
        /* fall through */
      }
    }

    uiStore.switchView('skymap');
    skyMap.navigateTo(ra, dec, Math.max(skyMap.getView().scale, 800));
  });
  targetsView.onEditDSO = (dso) => {
    openDSOEditModal(dso, () => {
      skyMap.render();
    });
  };

  // Update photo transforms and outlines when map view changes.
  // Hide photos during interaction and restore after 100ms to avoid painting large images on every frame.
  let interactionTimer: ReturnType<typeof setTimeout> | null = null;
  skyMap.setOnViewChange(() => {
    if (!interactionTimer) overlayDiv.classList.add('photos-frozen');
    else clearTimeout(interactionTimer);
    overlay.updateTransforms();
    skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
    interactionTimer = setTimeout(() => {
      interactionTimer = null;
      overlayDiv.classList.remove('photos-frozen');
    }, 100);
  });

  // Resize handler
  window.addEventListener('resize', () => skyMap.resize());

  // Register gallery and targetsView in canvas store so uiStore.switchView can use them
  useCanvasStore(pinia).init(skyMap, overlay, gallery, targetsView);

  // Sync photos store from overlay whenever photos change
  const photosStore = usePhotosStore(pinia);
  overlay.addOnPhotosChanged(() => photosStore.syncFromOverlay());

  // Setup view tab labels
  document.getElementById('tab-skymap')!.textContent = t('app.viewModeSkymap') || 'Sky Map';
  document.getElementById('tab-gallery')!.textContent = t('app.viewModeGallery') || 'Gallery';
  document.getElementById('tab-plans')!.textContent = t('targets.viewMode') || 'Plans';

  document
    .getElementById('tab-skymap')!
    .addEventListener('click', () => uiStore.switchView('skymap'));
  document
    .getElementById('tab-gallery')!
    .addEventListener('click', () => uiStore.switchView('gallery'));
  document
    .getElementById('tab-plans')!
    .addEventListener('click', () => uiStore.switchView('plans'));

  // Allow other modules to switch to skymap programmatically
  window.addEventListener('switchToSkymap', () => uiStore.switchView('skymap'));

  // Setup UI (panel, buttons, tooltips)
  setupUI(skyMap, overlay, gallery);

  // Mount Vue app after setupUI so modal callbacks are wired.
  mountVueApp(skyMap, overlay);

  // Load user-managed POI categories (shared by editors and filters). Push them into
  // the overlay + gallery so POI chips and filters resolve names/colours, and re-push
  // whenever the categories change (create/edit/delete).
  const poiCategoriesStore = usePoiCategoriesStore(pinia);
  const pushPoiCategories = () => {
    overlay.setPoiCategories(poiCategoriesStore.categories);
    gallery.setPoiCategories(poiCategoriesStore.categories);
  };
  poiCategoriesStore.$subscribe(pushPoiCategories);
  poiCategoriesStore.load().then(pushPoiCategories);

  // Load existing photos from backend
  try {
    const [photos, setups] = await Promise.all([
      getPhotos(),
      getGearSetups().catch(() => [] as Awaited<ReturnType<typeof getGearSetups>>),
    ]);
    gallery.setGearSetups(setups);
    overlay.loadPhotos(photos);
    gallery.loadPhotos(photos);
    // Ensure outlines are drawn on initial load (onViewChange hasn't fired yet)
    skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
    skyMap.render();
  } catch {
    showToast({ message: t('app.photosLoadError'), type: 'error' });
  }
}

/**
 * Compare the running build's version against the latest GitHub release and,
 * when a newer version exists and has not already been dismissed, open the
 * update-available modal. Fails silently — a version check must never disrupt
 * startup or annoy offline users.
 */
async function checkForUpdate() {
  try {
    const latest = await getLatestVersion();
    if (!latest?.version) return;
    if (!isUpdateAvailable(__APP_VERSION__, latest.version)) return;

    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(DISMISSED_UPDATE_KEY);
    } catch {
      /* ignore */
    }
    if (dismissed === latest.version) return;

    const uiStore = useUiStore(pinia);
    uiStore.pendingUpdate = { latest: latest.version, url: latest.url };
    openVueModal('update');
  } catch (err) {
    reportUnknownRendererError('update_check_failure', err);
  }
}

init()
  .then(() => {
    void checkForUpdate();
  })
  .catch((err) => {
    reportUnknownRendererError('app_init_failure', err);
  });
