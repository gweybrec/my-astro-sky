import { openVueModal } from './modal-host';
import { pinia } from './pinia-instance';
import { useDisplayStore } from './stores/display';
import { useSettingsStore } from './stores/settings';
import { useUiStore } from './stores/ui';
import { usePhotosStore } from './stores/photos';
import { loadSettings, saveSettings, normalizeRotationDeg } from './display-settings';
import type { Star, DSO, ViewMode, Photo, PlateSolveResult, PhotoCorrespondence, PhotoIntegration, ConstellationStyle } from './types';
import { isIAUStyle } from './types';
import { SkyMap } from './sky-map';
import { PhotoOverlay } from './photo-overlay';
import { Gallery, smartSortPhotos } from './gallery';
import { getDSOTypeName, searchUnified, searchDSOs } from './search';
import { uploadPhoto, solveWithSolveField, solveWithASTAP, submitPlateSolve, pollPlateSolve, solveWCS, updatePhotoMetadata, updatePhotoOrder, getPhotos, reuseAstrometrySubmission } from './api';
import type { ServerSettings, SolverAvailability } from './api';
import { getSolverAvailability } from './api';
import { DSO_CATALOGS_ALL, findDSOsInImage, getDSOById } from './dso-catalog';
import { computeAffineTransform } from './affine';
import { project, setHemisphere, toCanvas } from './projection';
import { showToast } from './toast';
import { t, getLang, setLang } from './i18n';
import { showMetadataEditor } from './metadata-editor';
import { stripExtension } from './file-utils';
import { openDSOEditModal } from './dso-editor';
import { buildPhotoQueryMatches } from './photo-search';
import { filterDrawOrderPhotos } from './photo-draw-order';
import { computeDSOHighlightShape } from './dso-highlight';
import { confirmPhotoDelete } from './photo-delete-confirm';


function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const toRad = Math.PI / 180;
  const d1 = dec1 * toRad;
  const d2 = dec2 * toRad;
  const dra = (ra2 - ra1) * toRad;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad;
}

function formatRA(raDeg: number): string {
  const raH = raDeg / 15;
  const h = Math.floor(raH);
  const m = Math.floor((raH - h) * 60);
  const s = ((raH - h) * 60 - m) * 60;
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}

function formatDec(decDeg: number): string {
  const sign = decDeg >= 0 ? '+' : '−';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${sign}${d}° ${m.toString().padStart(2, '0')}' ${s.toFixed(0).padStart(2, '0')}"`;
}

function formatSize(majAxis: number | null, minAxis: number | null): string {
  if (majAxis === null) return '–';
  const maj = majAxis >= 1 ? `${majAxis.toFixed(1)}'` : `${(majAxis * 60).toFixed(0)}"`;
  if (minAxis === null || Math.abs(majAxis - minAxis) < 0.1) return maj;
  const min = minAxis >= 1 ? `${minAxis.toFixed(1)}'` : `${(minAxis * 60).toFixed(0)}"`;
  return `${maj} × ${min}`;
}

function formatRating(rating: number | null): string {
  if (rating === null) return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function formatDifficulty(difficulty: number | null): string {
  if (difficulty === null) return '';
  return '◆'.repeat(difficulty) + '◇'.repeat(5 - difficulty);
}


export { positionPopup } from './popup-utils';
import { positionPopup } from './popup-utils';

export let triggerSelectDSOForPhotoChip: (dsoId: string) => void = () => {};
export let triggerBatchModal: (files: File[]) => void = () => {};
export let setDSOHighlight: (id: string | null) => void = () => {};
let _selectDSOInSearch: (dsoId: string) => void = () => {};
export function setSelectDSOInSearchHandler(fn: (dsoId: string) => void) {
  _selectDSOInSearch = fn;
}

export function setupUI(skyMap: SkyMap, overlay: PhotoOverlay, gallery: Gallery) {
  const panel = document.getElementById('side-panel')!;
  const appRoot = document.getElementById('app');
  const mapContainer = document.getElementById('map-container')!;

  const settings = loadSettings();
  let highlightedDSOForOverlay: string | null = null;

  const dsoHighlightCanvas = document.createElement('canvas');
  dsoHighlightCanvas.className = 'dso-highlight-overlay';
  mapContainer.appendChild(dsoHighlightCanvas);

  const MIN_HIGHLIGHT_PX = 7;

  const updateDSOHighlightOverlay = () => {
    const ctx2d = dsoHighlightCanvas.getContext('2d');
    if (!ctx2d) return;
    const view = skyMap.getView();
    if (dsoHighlightCanvas.width !== view.width || dsoHighlightCanvas.height !== view.height) {
      dsoHighlightCanvas.width = view.width;
      dsoHighlightCanvas.height = view.height;
    }
    ctx2d.clearRect(0, 0, view.width, view.height);
    if (!highlightedDSOForOverlay) return;
    const dso = getDSOById(highlightedDSOForOverlay);
    if (!dso) return;
    const p = project(dso.ra, dso.dec);
    const c = toCanvas(p.x, p.y, view);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return;

    const { rx, ry, angle } = computeDSOHighlightShape(dso, view, MIN_HIGHLIGHT_PX);
    const GAP = 4;

    ctx2d.save();
    ctx2d.translate(c.x, c.y);
    ctx2d.rotate(angle);
    ctx2d.scale(1, ry / rx);
    ctx2d.beginPath();
    ctx2d.arc(0, 0, rx + GAP, 0, Math.PI * 2);
    ctx2d.restore();
    ctx2d.strokeStyle = 'rgba(0, 255, 255, 0.9)';
    ctx2d.lineWidth = 2;
    ctx2d.setLineDash([]);
    ctx2d.shadowColor = 'rgba(0, 255, 255, 0.55)';
    ctx2d.shadowBlur = 6;
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;
  };

  const setHighlightedDSOState = (dsoId: string | null) => {
    highlightedDSOForOverlay = dsoId;
    skyMap.setHighlightedDSO(dsoId);
    updateDSOHighlightOverlay();
  };

  // Refresh photo outlines and gallery when photos change
  overlay.addOnPhotosChanged(() => {
    skyMap.setPhotoOutlines(overlay.getPhotoCanvasOutlines(skyMap.getView()));
    skyMap.render();
    gallery.loadPhotos(overlay.getPlacedPhotos().map(p => p.photo));
  });

  // Clicking a photo on the sky map selects it in the photos panel
  skyMap.setOnPhotoClick((photoName) => {
    const placed = overlay.getPlacedPhotos().find(p => p.photo.originalName === photoName);
    if (placed) usePhotosStore(pinia).selectPhoto(placed.photo.id);
  });

  // Clicking a DSO on the sky map triggers the same search-display flow as the search box
  skyMap.setOnDSOClick((dso) => {
    _selectDSOInSearch(dso.id);
  });

  // Navigate to map when clicking a gallery photo
  gallery.onNavigateToMap = (photo) => {
    window.dispatchEvent(new CustomEvent('switchToSkymap', {}));
    setTimeout(() => {
      const view = skyMap.getView();
      const fit = overlay.getPhotoCenterAndScale(photo.id, view.width, view.height);
      if (fit) skyMap.navigateTo(fit.ra, fit.dec, fit.scale);
    }, 80);
  };

  // Delete photo from gallery
  gallery.onDeletePhoto = (photo) => {
    overlay.hidePhoto(photo.id);
    showToast({
      message: t('photos.deleted', { name: photo.originalName }),
      type: 'undo',
      duration: 5000,
      actionLabel: t('photos.undo'),
      onAction: () => { overlay.unhidePhoto(photo.id); },
      onExpire: () => { overlay.removePhoto(photo.id); },
    });
  };

  // Sync metadata edits from gallery back to overlay and photos panel
  gallery.onPhotoMetadataUpdated = (updated) => {
    overlay.updatePhotoData(updated);
    usePhotosStore(pinia).syncFromOverlay();
  };

  // Wire callbacks for Vue photo panel
  triggerSelectDSOForPhotoChip = (dsoId) => { _selectDSOInSearch(dsoId); };
  triggerBatchModal = (files) => {
    useUiStore(pinia).pendingBatchFiles = files;
    openVueModal('batchUpload');
  };
  setDSOHighlight = setHighlightedDSOState;

  // Load server settings early so solver dropdowns know which options are available
  useSettingsStore(pinia).load();

  // ─── Star tooltip ───────────────────────────────────────────────────────────
  skyMap.setOnStarHover((star: Star | null, x: number, y: number) => {
    const ui = useUiStore(pinia);
    const ds = useDisplayStore(pinia);
    if (!star || !ds.showStarTooltips || ui.isSkyTooltipSuppressed()) {
      ui.setSkyTooltip(null, x, y);
      return;
    }
    const starMainName = (s: Star) =>
      s.name
      || (s.bayer && s.constellation ? `${s.bayer} ${s.constellation}` : null)
      || (s.flam  && s.constellation ? `${s.flam} ${s.constellation}`  : null)
      || `HIP ${s.hip}`;
    let html: string;
    if (ds.simplifiedDSOTooltips) {
      html = `<div class="dso-info-name">${starMainName(star)}</div><div class="tooltip-mag">${t('stars.magnitude')} ${star.mag.toFixed(2)}</div>`;
    } else {
      const rows: string[] = [];
      const desigParts: string[] = [];
      if (star.flam && star.constellation) desigParts.push(`${star.flam} ${star.constellation}`);
      if (star.bayer && star.constellation) desigParts.push(`${star.bayer} ${star.constellation}`);
      if (star.desig && !star.flam) desigParts.push(star.desig);
      if (desigParts.length) rows.push(`<tr><td>${t('stars.designation')}</td><td>${desigParts.join(' · ')}</td></tr>`);
      rows.push(`<tr><td>HIP</td><td>${star.hip}</td></tr>`);
      rows.push(`<tr><td>${t('stars.magnitude')}</td><td>${star.mag.toFixed(2)}</td></tr>`);
      if (star.constellation) rows.push(`<tr><td>${t('stars.constellation')}</td><td>${star.constellation}</td></tr>`);
      rows.push(`<tr><td>${t('dso.raDec')}</td><td>${formatRA(star.ra)} / ${formatDec(star.dec)}</td></tr>`);
      html = `<div class="dso-info-name">${starMainName(star)}</div><table class="dso-info-table">${rows.join('')}</table>`;
    }
    ui.setSkyTooltip(html, x, y);
  });

  // ─── DSO tooltip ────────────────────────────────────────────────────────────
  skyMap.setOnDSOHover((dso: DSO | null, x: number, y: number) => {
    const ui = useUiStore(pinia);
    const ds = useDisplayStore(pinia);
    if (!dso || !ds.showDSOTooltips || ui.isSkyTooltipSuppressed()) {
      ui.setSkyTooltip(null, x, y);
      return;
    }
    let html: string;
    if (ds.simplifiedDSOTooltips) {
      const mainName = dso.displayName || dso.id;
      const magStr = dso.mag !== null ? dso.mag.toFixed(1) : '–';
      html = `<div class="dso-info-name">${mainName}</div><div class="tooltip-mag">${t('stars.magnitude')} ${magStr}</div>`;
    } else {
      const typeName = getDSOTypeName(dso.type);
      const magStr = dso.mag !== null ? dso.mag.toFixed(1) : '–';
      const sizeStr = formatSize(dso.majAxis, dso.minAxis);
      const isLPN = dso.id.startsWith('LPN-');
      const bestId = dso.catalogs[0] ?? dso.id;
      const stripWs = (s: string) => s.replace(/\s+/g, '');
      const headerStr = dso.displayName
        ? (isLPN || stripWs(dso.displayName).includes(stripWs(bestId)) ? dso.displayName : `${dso.displayName} – ${bestId}`)
        : (isLPN ? bestId.replace(/^LPN-/, '') : bestId);
      const nameStr = `<div class="dso-info-name">${headerStr}</div>`;
      const sizeRow = sizeStr !== '–' ? `<tr><td>${t('dso.size')}</td><td>${sizeStr}</td></tr>` : '';
      const raDec = `${formatRA(dso.ra)} / ${formatDec(dso.dec)}`;
      const ratingRow = dso.rating !== null ? `<tr><td>${t('targets.ratingFilter')}</td><td>${formatRating(dso.rating)}</td></tr>` : '';
      const difficultyRow = dso.difficulty !== null ? `<tr><td>${t('targets.sort.difficulty')}</td><td>${formatDifficulty(dso.difficulty)}</td></tr>` : '';
      const crossRefs = dso.catalogs.slice(1).filter(c => !c.startsWith('LPN-'));
      const crossRefRow = crossRefs.length > 0 ? `<tr><td>${t('dso.alsoKnownAs')}</td><td>${crossRefs.join('<br>')}</td></tr>` : '';
      const emissionLinesRow = dso.emissionLines ? `<tr><td>${t('dso.emissionLines')}</td><td>${dso.emissionLines}</td></tr>` : '';
      html = `${nameStr}<table class="dso-info-table"><tr><td>${t('dso.type')}</td><td>${typeName}</td></tr><tr><td>${t('stars.magnitude')}</td><td>${magStr}</td></tr>${sizeRow}<tr><td>${t('dso.raDec')}</td><td>${raDec}</td></tr>${ratingRow}${difficultyRow}${emissionLinesRow}${crossRefRow}</table>`;
    }
    // Only full-mode tooltips carry the DSO (and thus the interactive action buttons);
    // simplified tooltips stay minimal.
    ui.setSkyTooltip(html, x, y, ds.simplifiedDSOTooltips ? null : dso);
  });

  // Panel toggle → use store
  const uiStore = useUiStore(pinia);
  uiStore.panelCollapsed = panel.classList.contains('collapsed');
  document.getElementById('toggle-panel')!.addEventListener('click', () => {
    uiStore.setPanelCollapsed(!uiStore.panelCollapsed);
  });

  // ─── Apply initial settings to SkyMap and PhotoOverlay ───────────────────
  setHemisphere(settings.hemisphere);
  skyMap.setHemisphere(settings.hemisphere, settings.borderLatDeg);
  skyMap.setRotationDeg(settings.mapRotationDeg);
  overlay.setBorderParams(settings.hemisphere, settings.borderLatDeg);

  skyMap.setShowStars(settings.showStars);
  skyMap.setShowConstellationLines(settings.showConstellationLines);
  skyMap.setShowConstellationNames(
    isIAUStyle(settings.constellationStyle) ? settings.showConstellationNames : false
  );
  if (settings.constellationStyle !== 'western') {
    skyMap.setConstellationStyle(settings.constellationStyle);
  }
  skyMap.setShowStarLabels(settings.showStarLabels);
  skyMap.setShowDSOLabels(settings.showDSOLabels);
  skyMap.setShowGrid(settings.showGrid);
  overlay.setShowPhotos(settings.showPhotos);
  overlay.setVisibleLabels(settings.visibleLabels || {});
  skyMap.setShowPhotoOutlines(settings.showPhotoOutlines);
  skyMap.setSkyOpacity(settings.skyOpacity);
  skyMap.setBackgroundOpacity(settings.backgroundOpacity);
  skyMap.setShowDSOs(settings.showDSOs);
  skyMap.setVisibleDSOTypes(new Set(settings.dsoTypes));
  skyMap.setVisibleDSOCatalogs(new Set(settings.dsoCatalogs));
  skyMap.setMaxStarCount(settings.maxStarCount);
  skyMap.setMaxDSOCount(settings.maxDSOCount);
  overlay.setDefaultOpacity(1.0);

  // ─── Hook into view change (dismiss tooltip, persist rotation, sync store) ──────────────
  const origOnViewChange = (skyMap as any)['onViewChange'] as (() => void) | null;
  skyMap.setOnViewChange(() => {
    origOnViewChange?.();
    // The tooltip is anchored to a fixed screen position; once the sky pans/zooms it
    // is stale, so dismiss it as soon as the view starts moving.
    const uiForTooltip = useUiStore(pinia);
    if (uiForTooltip.skyTooltipHtml) uiForTooltip.hideSkyTooltipNow();
    const currentRotation = normalizeRotationDeg(skyMap.getView().rotationDeg);
    if (currentRotation !== settings.mapRotationDeg) {
      settings.mapRotationDeg = currentRotation;
      saveSettings(settings);
    }
    updateDSOHighlightOverlay();
    useDisplayStore(pinia).onMapViewChanged(currentRotation);
  });

  // ─── Initialise section visibility for current view mode ─────────────────
  uiStore.switchView(uiStore.currentViewMode);

}
