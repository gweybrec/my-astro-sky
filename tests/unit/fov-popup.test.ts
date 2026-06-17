import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Keep the heavy gear/catalog/targets modules out of the popup under test.
vi.mock('../../src/api', () => ({
  getGearSetups: vi.fn().mockResolvedValue([
    { id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null, enabled: true },
  ]),
  createGearSetup: vi.fn(),
  updateGearSetup: vi.fn(),
}));
vi.mock('../../src/gear-catalog', () => ({
  getTelescopes: vi.fn().mockResolvedValue([{ id: 't1', focal_length_mm: 500, aperture_mm: 80 }]),
  getCameras: vi.fn().mockResolvedValue([{ id: 'c1', sensor_width_mm: 23, sensor_height_mm: 15, pixel_size_um: 3.8, color_type: 'OSC' }]),
  getAccessories: vi.fn().mockResolvedValue([]),
  buildGearPreset: vi.fn().mockReturnValue({ focalLengthMm: 500, sensorWidthMm: 23, sensorHeightMm: 15 }),
}));
vi.mock('../../src/gear-presets', () => ({
  fovDeg: vi.fn().mockReturnValue({ wDeg: 2.5, hDeg: 1.7 }),
  formatSetupCanvasLabel: vi.fn().mockReturnValue('Setup 1 · 2.5° × 1.7°'),
}));
vi.mock('../../src/dso-catalog', () => ({
  getDSOById: vi.fn((id: string) => (id === 'M42' ? { id: 'M42', ra: 83.8, dec: -5.4, displayName: 'Orion Nebula' } : undefined)),
}));
vi.mock('../../src/targets-view', () => ({ buildGearSectionContent: vi.fn() }));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { buildFovPopup } from '../../src/fov-overlay';
import { useFovFramesStore } from '../../src/stores/fov-frames';
import { usePlansStore } from '../../src/stores/plans';
import { useUiStore } from '../../src/stores/ui';
import { useCanvasStore } from '../../src/stores/canvas';

function seedPlan(setupId: string | null, entries: any[]) {
  const plans = usePlansStore();
  (plans as any).plans = [{ id: 'p1', name: 'Tonight', position: 0, nightOf: null, setupId, entries }];
  (plans as any).loaded = true;
}

describe('buildFovPopup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('lists Free frames, every plan, and a New plan option', () => {
    seedPlan('s1', []);
    const popup = buildFovPopup(() => {});
    const opts = Array.from(popup.querySelectorAll('select option')).map(o => (o as HTMLOptionElement).textContent);
    expect(opts).toContain('Free frames');
    expect(opts).toContain('Tonight');
    expect(opts).toContain('+ New plan');
    popup.__cleanup?.();
  });

  it('suppresses the sky tooltip while the cursor is over the popup', () => {
    seedPlan('s1', []);
    const ui = useUiStore();
    const spy = vi.spyOn(ui, 'setForceSuppressTooltip');
    const popup = buildFovPopup(() => {});
    popup.dispatchEvent(new MouseEvent('mouseenter'));
    expect(spy).toHaveBeenCalledWith(true);
    popup.dispatchEvent(new MouseEvent('mouseleave'));
    expect(spy).toHaveBeenCalledWith(false);
    popup.__cleanup?.();
  });

  it('labels a plan-entry row by its DSO name', async () => {
    seedPlan('s1', [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.textContent).toContain('Orion Nebula');
    popup.__cleanup?.();
  });

  it('labels a null-DSO plan entry as a custom location', async () => {
    seedPlan('s1', [{ id: 'e1', dsoId: null, position: 0, paDeg: null, ra: 12, dec: 34, notes: null }]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.textContent).toContain('Custom location');
    popup.__cleanup?.();
  });

  it('shows the anchor toggle on both free and plan rows (parity)', async () => {
    seedPlan('s1', [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    const anchorSel = '[title="Anchor: snapping to nearest object"], [title="Anchor off: pin anywhere"]';

    // Free row: anchor toggle present.
    store.addAdhocFrame('s1');
    let popup = buildFovPopup(() => {});
    let row = popup.querySelector('.fov-popup-setup-row')!;
    expect(row.querySelector(anchorSel)).not.toBeNull();
    popup.__cleanup?.();

    // Plan row: anchor toggle also present (same actions as free mode).
    store.setSelection({ kind: 'plan', planId: 'p1' });
    popup = buildFovPopup(() => {});
    row = popup.querySelector('.fov-popup-setup-row')!;
    expect(row.querySelector(anchorSel)).not.toBeNull();
    popup.__cleanup?.();
  });

  it('anchor toggle reflects on/off via the active class + aria-pressed', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.addAdhocFrame('s1');
    const id = store.activeId!;
    const anchorSel = '[title="Anchor: snapping to nearest object"], [title="Anchor off: pin anywhere"]';

    // Default: anchoring on → active class + aria-pressed="true".
    let popup = buildFovPopup(() => {});
    let btn = popup.querySelector('.fov-popup-setup-row ' + anchorSel) as HTMLButtonElement;
    expect(btn.className).toBe('btn-icon btn-icon--active');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    popup.__cleanup?.();

    // Toggle off → plain btn-icon (no opacity dimming) + aria-pressed="false".
    store.toggleAnchorSnap(id);
    popup = buildFovPopup(() => {});
    btn = popup.querySelector('.fov-popup-setup-row ' + anchorSel) as HTMLButtonElement;
    expect(btn.className).toBe('btn-icon');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    popup.__cleanup?.();
  });

  it('plan mode: setup dropdown lists the gear setup with its FOV label and selects the plan setup', async () => {
    seedPlan('s1', [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    await new Promise(r => setTimeout(r)); // let getGearSetups + renderAll run

    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(setupSel.style.display).not.toBe('none');
    const labels = Array.from(setupSel.options).map(o => o.textContent);
    expect(labels.filter(l => l === 'Setup 1 · 2.5° × 1.7°').length).toBe(1);
    expect(setupSel.value).toBe('s1');
    popup.__cleanup?.();
  });

  it('plan mode: changing the setup dropdown persists to the plan', async () => {
    seedPlan(null, [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }]);
    const store = useFovFramesStore();
    const plans = usePlansStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    await new Promise(r => setTimeout(r));

    const spy = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    setupSel.value = 's1';
    setupSel.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith('p1', null, 's1');
    popup.__cleanup?.();
  });

  it('free mode: the setup dropdown is hidden', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.addAdhocFrame('s1');
    const popup = buildFovPopup(() => {});
    await new Promise(r => setTimeout(r));
    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(setupSel.style.display).toBe('none');
    popup.__cleanup?.();
  });

  it('free mode: select-all tristate + per-row visibility checkboxes; reflects hidden state', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.addAdhocFrame('s1');
    const a = store.activeId!;
    store.addAdhocFrame('s1');

    // Hide one frame so the select-all should be indeterminate.
    store.setAdhocVisible(a, false);

    const popup = buildFovPopup(() => {});
    const selectAll = popup.querySelector('.fov-popup-select-all-row input[type="checkbox"]') as HTMLInputElement;
    expect(selectAll).not.toBeNull();
    expect(selectAll.indeterminate).toBe(true);

    // One checkbox per frame row.
    const rowBoxes = popup.querySelectorAll('.fov-popup-setup-row input[type="checkbox"]');
    expect(rowBoxes.length).toBe(2);
    popup.__cleanup?.();
  });

  it('plan mode: no visibility checkboxes', async () => {
    seedPlan('s1', [{ id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null }]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.querySelector('.fov-popup-select-all-row')).toBeNull();
    expect(popup.querySelector('.fov-popup-setup-row input[type="checkbox"]')).toBeNull();
    popup.__cleanup?.();
  });

  it('plan mode: shows the "Add a frame" footer once the plan has a gear setup, hidden otherwise', async () => {
    const store = useFovFramesStore();
    await store.loadSpecs();

    // No gear setup → footer hidden (a plan can't size/render frames).
    seedPlan(null, []);
    store.setSelection({ kind: 'plan', planId: 'p1' });
    let popup = buildFovPopup(() => {});
    expect(popup.querySelector('.fov-popup-footer')!.classList.contains('hidden')).toBe(true);
    popup.__cleanup?.();

    // With a gear setup → footer visible.
    seedPlan('s1', []);
    store.setSelection({ kind: 'plan', planId: 'p1' });
    popup = buildFovPopup(() => {});
    expect(popup.querySelector('.fov-popup-footer')!.classList.contains('hidden')).toBe(false);
    popup.__cleanup?.();
  });

  it('plan mode: clicking "Add a frame" spawns a custom-location frame at the view centre', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });

    // Stub the sky map so the popup can read the view centre.
    const canvas = useCanvasStore();
    (canvas as any).skyMap = {
      pinActiveIfFloating: vi.fn(),
      viewCenterSky: vi.fn().mockReturnValue({ ra: 200, dec: -10 }),
    };
    const spy = vi.spyOn(store, 'addPlanFrame').mockResolvedValue();

    const popup = buildFovPopup(() => {});
    const addBtn = popup.querySelector('.fov-popup-footer button') as HTMLButtonElement;
    addBtn.click();

    expect(spy).toHaveBeenCalledWith('p1', 200, -10);
    popup.__cleanup?.();
  });

  it('does not render a separate center-on-map button (name click centers)', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.addAdhocFrame('s1');
    const popup = buildFovPopup(() => {});
    // No standalone center button; the name carries the "center on map" affordance.
    expect(popup.querySelector('button[title="Center on map"]')).toBeNull();
    expect(popup.querySelector('.fov-popup-setup-row .flex-1')!.getAttribute('title')).toBe('Center on map');
    popup.__cleanup?.();
  });
});
