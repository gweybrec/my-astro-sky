import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ConstellationStyle } from '../types';
import { isIAUStyle } from '../types';
import { loadSettings, saveSettings, normalizeRotationDeg } from '../display-settings';
import { AUTO_STAR_BUDGET } from '../density-slider';
import { useCanvasStore } from './canvas';

export const useDisplayStore = defineStore('display', () => {
  const canvasStore = useCanvasStore();
  const s = loadSettings();

  // ─── State ───────────────────────────────────────────────────────────────────
  const showStars = ref(s.showStars);
  const showConstellationLines = ref(s.showConstellationLines);
  const showConstellationNames = ref(s.showConstellationNames);
  const showStarLabels = ref(s.showStarLabels);
  const showDSOLabels = ref(s.showDSOLabels);
  const showGrid = ref(s.showGrid);
  const showPhotos = ref(s.showPhotos);
  const showPhotoOutlines = ref(s.showPhotoOutlines);
  const visibleLabels = ref<{ [label: string]: boolean }>({ ...s.visibleLabels });
  const maxStarCount = ref(s.maxStarCount);
  const maxDSOCount = ref(s.maxDSOCount);
  const autoStarDensity = ref(s.autoStarDensity);
  const autoDSODensity = ref(s.autoDSODensity);
  const reduceDetailWhileMoving = ref(s.reduceDetailWhileMoving);
  const skyOpacity = ref(s.skyOpacity);
  const backgroundOpacity = ref(s.backgroundOpacity);
  const showDSOs = ref(s.showDSOs);
  const dsoTypes = ref<string[]>([...s.dsoTypes]);
  const dsoCatalogs = ref<string[]>([...s.dsoCatalogs]);
  const showStarTooltips = ref(s.showStarTooltips);
  const showDSOTooltips = ref(s.showDSOTooltips);
  const simplifiedDSOTooltips = ref(s.simplifiedDSOTooltips);
  const hemisphere = ref<'north' | 'south'>(s.hemisphere);
  const borderLatDeg = ref(s.borderLatDeg);
  const mapRotationDeg = ref(s.mapRotationDeg);
  const constellationStyle = ref<ConstellationStyle>(s.constellationStyle);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function snap() {
    return {
      showStars: showStars.value,
      showConstellationLines: showConstellationLines.value,
      showConstellationNames: showConstellationNames.value,
      showStarLabels: showStarLabels.value,
      showDSOLabels: showDSOLabels.value,
      showGrid: showGrid.value,
      showPhotos: showPhotos.value,
      showPhotoOutlines: showPhotoOutlines.value,
      visibleLabels: { ...visibleLabels.value },
      maxStarCount: maxStarCount.value,
      maxDSOCount: maxDSOCount.value,
      autoStarDensity: autoStarDensity.value,
      autoDSODensity: autoDSODensity.value,
      reduceDetailWhileMoving: reduceDetailWhileMoving.value,
      skyOpacity: skyOpacity.value,
      backgroundOpacity: backgroundOpacity.value,
      showDSOs: showDSOs.value,
      dsoTypes: [...dsoTypes.value],
      dsoCatalogs: [...dsoCatalogs.value],
      showStarTooltips: showStarTooltips.value,
      showDSOTooltips: showDSOTooltips.value,
      simplifiedDSOTooltips: simplifiedDSOTooltips.value,
      hemisphere: hemisphere.value,
      borderLatDeg: borderLatDeg.value,
      mapRotationDeg: mapRotationDeg.value,
      constellationStyle: constellationStyle.value,
    };
  }

  function persist() { saveSettings(snap()); }

  // ─── Actions ─────────────────────────────────────────────────────────────────
  // canvasStore.skyMap / canvasStore.overlay are already unwrapped by Pinia

  function setShowStars(v: boolean) {
    showStars.value = v;
    canvasStore.skyMap?.setShowStars(v);
    persist();
  }

  function setShowConstellationLines(v: boolean) {
    showConstellationLines.value = v;
    canvasStore.skyMap?.setShowConstellationLines(v);
    persist();
  }

  function setShowConstellationNames(v: boolean) {
    showConstellationNames.value = v;
    canvasStore.skyMap?.setShowConstellationNames(v);
    persist();
  }

  async function setConstellationStyle(style: ConstellationStyle) {
    await canvasStore.skyMap?.setConstellationStyle(style);
    constellationStyle.value = style;
    if (!isIAUStyle(style)) {
      canvasStore.skyMap?.setShowConstellationNames(false);
    } else {
      canvasStore.skyMap?.setShowConstellationNames(showConstellationNames.value);
    }
    persist();
  }

  function setShowStarLabels(v: boolean) {
    showStarLabels.value = v;
    canvasStore.skyMap?.setShowStarLabels(v);
    persist();
  }

  function setShowDSOLabels(v: boolean) {
    showDSOLabels.value = v;
    canvasStore.skyMap?.setShowDSOLabels(v);
    persist();
  }

  function setShowGrid(v: boolean) {
    showGrid.value = v;
    canvasStore.skyMap?.setShowGrid(v);
    persist();
  }

  function setShowPhotos(v: boolean) {
    showPhotos.value = v;
    canvasStore.overlay?.setShowPhotos(v);
    persist();
  }

  function setShowPhotoOutlines(v: boolean) {
    showPhotoOutlines.value = v;
    canvasStore.skyMap?.setShowPhotoOutlines(v);
    persist();
  }

  function setVisibleLabel(label: string, visible: boolean) {
    visibleLabels.value = { ...visibleLabels.value, [label]: visible };
    canvasStore.overlay?.setVisibleLabels(visibleLabels.value);
    persist();
  }

  function setAllLabels(labels: string[], visible: boolean) {
    const next: { [label: string]: boolean } = {};
    for (const l of labels) next[l] = visible;
    visibleLabels.value = next;
    canvasStore.overlay?.setVisibleLabels(visibleLabels.value);
    persist();
  }

  function setSkyOpacity(v: number) {
    skyOpacity.value = v;
    canvasStore.skyMap?.setSkyOpacity(v);
    persist();
  }

  function setBackgroundOpacity(v: number) {
    backgroundOpacity.value = v;
    canvasStore.skyMap?.setBackgroundOpacity(v);
    persist();
  }

  function setMaxStarCount(count: number) {
    maxStarCount.value = count;
    canvasStore.skyMap?.setMaxStarCount(count);
    persist();
  }

  function setMaxDSOCount(count: number) {
    maxDSOCount.value = count;
    canvasStore.skyMap?.setMaxDSOCount(count);
    persist();
  }

  function setAutoStarDensity(v: boolean) {
    autoStarDensity.value = v;
    // In auto mode the star budget is fixed (constellations + bright stars); pin it so the
    // disabled slider and the renderer agree.
    if (v) {
      maxStarCount.value = AUTO_STAR_BUDGET;
      canvasStore.skyMap?.setMaxStarCount(AUTO_STAR_BUDGET);
    }
    canvasStore.skyMap?.setAutoStarDensity(v);
    persist();
  }

  function setAutoDSODensity(v: boolean) {
    autoDSODensity.value = v;
    canvasStore.skyMap?.setAutoDSODensity(v);
    persist();
  }

  /** Applied from the SkyMap DSO performance lever: reflect the tuned DSO budget in the
   * (disabled) slider and persist it, without re-pushing to the map (it set the value). */
  function applyAutoDensity(dso: number) {
    maxDSOCount.value = dso;
    persist();
  }

  function setReduceDetailWhileMoving(v: boolean) {
    reduceDetailWhileMoving.value = v;
    canvasStore.skyMap?.setMotionLOD(v);
    persist();
  }

  function setShowDSOs(v: boolean) {
    showDSOs.value = v;
    canvasStore.skyMap?.setShowDSOs(v);
    persist();
  }

  function setDsoTypes(types: string[]) {
    dsoTypes.value = [...types];
    canvasStore.skyMap?.setVisibleDSOTypes(new Set(types));
    persist();
  }

  function setDsoCatalogs(catalogs: string[]) {
    dsoCatalogs.value = [...catalogs];
    canvasStore.skyMap?.setVisibleDSOCatalogs(new Set(catalogs));
    persist();
  }

  function setShowStarTooltips(v: boolean) {
    showStarTooltips.value = v;
    persist();
  }

  function setShowDSOTooltips(v: boolean) {
    showDSOTooltips.value = v;
    persist();
  }

  function setSimplifiedDSOTooltips(v: boolean) {
    simplifiedDSOTooltips.value = v;
    persist();
  }

  function setHemisphere(h: 'north' | 'south') {
    hemisphere.value = h;
    const sm = canvasStore.skyMap;
    const ov = canvasStore.overlay;
    sm?.setHemisphere(h, borderLatDeg.value);
    ov?.setBorderParams(h, borderLatDeg.value);
    ov?.updateTransforms();
    persist();
  }

  function setBorderLatDeg(deg: number) {
    borderLatDeg.value = deg;
    const sm = canvasStore.skyMap;
    const ov = canvasStore.overlay;
    sm?.setBorderLatDeg(deg);
    ov?.setBorderParams(hemisphere.value, deg);
    ov?.updateTransforms();
    persist();
  }

  /** Called from the setOnViewChange hook in ui.ts when the map view changes. */
  function onMapViewChanged(newRotationDeg: number) {
    mapRotationDeg.value = newRotationDeg;
  }

  function setMapRotationDeg(deg: number) {
    const normalized = normalizeRotationDeg(deg);
    canvasStore.skyMap?.setRotationDeg(normalized);
    mapRotationDeg.value = normalized;
    persist();
  }

  return {
    // state
    showStars, showConstellationLines, showConstellationNames,
    showStarLabels, showDSOLabels, showGrid, showPhotos, showPhotoOutlines,
    visibleLabels, maxStarCount, maxDSOCount,
    autoStarDensity, autoDSODensity, reduceDetailWhileMoving,
    skyOpacity, backgroundOpacity,
    showDSOs, dsoTypes, dsoCatalogs,
    showStarTooltips, showDSOTooltips, simplifiedDSOTooltips,
    hemisphere, borderLatDeg, mapRotationDeg, constellationStyle,
    // actions
    setShowStars, setShowConstellationLines, setShowConstellationNames,
    setConstellationStyle, setShowStarLabels, setShowDSOLabels, setShowGrid,
    setShowPhotos, setShowPhotoOutlines, setVisibleLabel, setAllLabels,
    setSkyOpacity, setBackgroundOpacity,
    setMaxStarCount, setMaxDSOCount,
    setAutoStarDensity, setAutoDSODensity, applyAutoDensity, setReduceDetailWhileMoving,
    setShowStarTooltips, setShowDSOTooltips, setSimplifiedDSOTooltips,
    setHemisphere, setBorderLatDeg, onMapViewChanged, setMapRotationDeg,
    setShowDSOs, setDsoTypes, setDsoCatalogs,
  };
});
