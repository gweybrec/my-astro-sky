import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Keep the heavy gear/catalog/targets modules out of the popup under test.
vi.mock('../../src/api', () => ({
  getGearSetups: vi.fn().mockResolvedValue([
    {
      id: 's1',
      name: 'Setup 1',
      telescopeId: 't1',
      cameraId: 'c1',
      accessoryId: null,
      enabled: true,
    },
  ]),
  createGearSetup: vi.fn(),
  updateGearSetup: vi.fn(),
}));
vi.mock('../../src/gear-catalog', () => ({
  getTelescopes: vi.fn().mockResolvedValue([{ id: 't1', focal_length_mm: 500, aperture_mm: 80 }]),
  getCameras: vi.fn().mockResolvedValue([
    {
      id: 'c1',
      sensor_width_mm: 23,
      sensor_height_mm: 15,
      pixel_size_um: 3.8,
      color_type: 'OSC',
    },
  ]),
  getAccessories: vi.fn().mockResolvedValue([]),
  buildGearPreset: vi
    .fn()
    .mockReturnValue({ focalLengthMm: 500, sensorWidthMm: 23, sensorHeightMm: 15 }),
  resolveSetupCamera: vi.fn(
    (
      tel: { is_smart_telescope?: boolean; integrated_camera_id?: string | null },
      cams: { id: string }[],
      cameraId: string | null | undefined,
    ) => {
      const wanted =
        tel.is_smart_telescope && tel.integrated_camera_id ? tel.integrated_camera_id : cameraId;
      return cams.find((c) => c.id === wanted) ?? null;
    },
  ),
}));
vi.mock('../../src/gear-presets', () => ({
  fovDeg: vi.fn().mockReturnValue({ wDeg: 2.5, hDeg: 1.7 }),
  formatSetupCanvasLabel: vi.fn().mockReturnValue('Setup 1 · 2.5° × 1.7°'),
  formatFov: vi.fn().mockReturnValue('5.0° × 3.0°'),
}));
vi.mock('../../src/dso-catalog', () => ({
  getDSOById: vi.fn((id: string) =>
    id === 'M42' ? { id: 'M42', ra: 83.8, dec: -5.4, displayName: 'Orion Nebula' } : undefined,
  ),
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
  (plans as any).plans = [
    {
      id: 'p1',
      name: 'Tonight',
      position: 0,
      nightOf: null,
      setupId,
      lat: null,
      lon: null,
      entries,
    },
  ];
  (plans as any).loaded = true;
}

describe('buildFovPopup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('lists Free frames and every plan (creating a plan is a dedicated button)', () => {
    seedPlan('s1', []);
    const popup = buildFovPopup(() => {});
    const opts = Array.from(popup.querySelectorAll('select option')).map(
      (o) => (o as HTMLOptionElement).textContent,
    );
    expect(opts).toContain('Free frames');
    expect(opts).toContain('Tonight');
    // The "+ New plan" dropdown entry was replaced by a [+] icon button.
    expect(opts).not.toContain('+ New plan');
    expect(popup.querySelector('[title="New plan"]')).not.toBeNull();
    popup.__cleanup?.();
  });

  it('is marked .fov-popup so the store suppresses tooltips over it (no leaky enter/leave flag)', () => {
    seedPlan('s1', []);
    const ui = useUiStore();
    // The popup no longer toggles a force-suppress flag on hover (which could get
    // stuck if the popup is removed mid-hover). Instead it carries the .fov-popup
    // marker; the store hit-tests the cursor against it.
    const spy = vi.spyOn(ui, 'setForceSuppressTooltip');
    const popup = buildFovPopup(() => {});
    expect(popup.classList.contains('fov-popup')).toBe(true);
    popup.dispatchEvent(new MouseEvent('mouseenter'));
    popup.dispatchEvent(new MouseEvent('mouseleave'));
    expect(spy).not.toHaveBeenCalled();

    // Cursor over the popup → suppressed; over the map → not.
    document.body.appendChild(popup);
    const ptSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(popup);
    expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(true);
    ptSpy.mockReturnValue(document.body);
    expect(ui.isSkyTooltipSuppressed(10, 10)).toBe(false);
    ptSpy.mockRestore();
    popup.__cleanup?.();
  });

  it('labels a plan-entry row by its DSO name', async () => {
    seedPlan('s1', [
      { id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null },
    ]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.textContent).toContain('Orion Nebula');
    popup.__cleanup?.();
  });

  it('labels a null-DSO plan entry as a custom location', async () => {
    seedPlan('s1', [
      { id: 'e1', dsoId: null, position: 0, paDeg: null, ra: 12, dec: 34, notes: null },
    ]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.textContent).toContain('Custom location');
    popup.__cleanup?.();
  });

  it('shows the anchor toggle on both free and plan rows (parity)', async () => {
    seedPlan('s1', [
      { id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null },
    ]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    const anchorSel =
      '[title="Anchor: snapping to nearest object"], [title="Anchor off: pin anywhere"]';

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
    const anchorSel =
      '[title="Anchor: snapping to nearest object"], [title="Anchor off: pin anywhere"]';

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
    seedPlan('s1', [
      { id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null },
    ]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    await new Promise((r) => setTimeout(r)); // let getGearSetups + renderAll run

    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(setupSel.style.display).not.toBe('none');
    const labels = Array.from(setupSel.options).map((o) => o.textContent);
    expect(labels.filter((l) => l === 'Setup 1 · 2.5° × 1.7°').length).toBe(1);
    expect(setupSel.value).toBe('s1');
    popup.__cleanup?.();
  });

  it('plan mode: changing the setup dropdown persists to the plan (no mosaics → direct)', async () => {
    seedPlan(null, [
      { id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null },
    ]);
    const store = useFovFramesStore();
    const plans = usePlansStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    await new Promise((r) => setTimeout(r));

    const spy = vi.spyOn(plans, 'updatePlanSettings').mockResolvedValue();
    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    setupSel.value = 's1';
    setupSel.dispatchEvent(new Event('change'));
    // onSetupChange now awaits loadSpecs to decide whether mosaics need a
    // transformation popup; with none it persists directly on the next tick.
    await new Promise((r) => setTimeout(r));
    expect(spy).toHaveBeenCalledWith('p1', null, 's1', null, null);
    expect(document.querySelector('.modal-backdrop')).toBeNull(); // no switch modal
    popup.__cleanup?.();
  });

  it('free mode: the setup dropdown is hidden', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.addAdhocFrame('s1');
    const popup = buildFovPopup(() => {});
    await new Promise((r) => setTimeout(r));
    const setupSel = popup.querySelectorAll('select')[1] as HTMLSelectElement;
    // The setup dropdown and its [+]/[edit] controls share a row that is hidden
    // outside plan mode.
    expect((setupSel.parentElement as HTMLElement).style.display).toBe('none');
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
    const selectAll = popup.querySelector(
      '.fov-popup-select-all-row input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(selectAll).not.toBeNull();
    expect(selectAll.indeterminate).toBe(true);

    // One checkbox per frame row.
    const rowBoxes = popup.querySelectorAll('.fov-popup-setup-row input[type="checkbox"]');
    expect(rowBoxes.length).toBe(2);
    popup.__cleanup?.();
  });

  it('plan mode: no visibility checkboxes', async () => {
    seedPlan('s1', [
      { id: 'e1', dsoId: 'M42', position: 0, paDeg: null, ra: null, dec: null, notes: null },
    ]);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});
    expect(popup.querySelector('.fov-popup-select-all-row')).toBeNull();
    expect(popup.querySelector('.fov-popup-setup-row input[type="checkbox"]')).toBeNull();
    popup.__cleanup?.();
  });

  it('plan mode: shows the "Add a frame" action once the plan has a gear setup, hidden otherwise', async () => {
    const store = useFovFramesStore();
    await store.loadSpecs();
    const addFrameBtn = (popup: HTMLElement) =>
      Array.from(popup.querySelectorAll('.fov-popup-footer button')).find(
        (b) => b.getAttribute('title') === 'Add a frame',
      ) as HTMLButtonElement;

    // No gear setup → add-frame action hidden (a plan can't size/render frames),
    // but the footer row itself (with the plan-details jump) stays visible.
    seedPlan(null, []);
    store.setSelection({ kind: 'plan', planId: 'p1' });
    let popup = buildFovPopup(() => {});
    expect(addFrameBtn(popup).classList.contains('hidden')).toBe(true);
    popup.__cleanup?.();

    // With a gear setup → add-frame action visible.
    seedPlan('s1', []);
    store.setSelection({ kind: 'plan', planId: 'p1' });
    popup = buildFovPopup(() => {});
    expect(addFrameBtn(popup).classList.contains('hidden')).toBe(false);
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

  it('mosaic row: suffixes the name with "Mosaic", shows the grid size, and offers an edit button', async () => {
    seedPlan('s1', []);
    const plans = usePlansStore();
    (plans as any).plans[0].mosaics = [
      {
        id: 'm1',
        dsoId: 'M42',
        centerRa: 83.8,
        centerDec: -5.4,
        paDeg: 0,
        overlapPct: 20,
        cols: 3,
        rows: 2,
      },
    ];
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const popup = buildFovPopup(() => {});

    const row = popup.querySelector('.fov-popup-setup-row')!;
    expect(row.textContent).toContain('Orion Nebula · Mosaic');
    expect(row.textContent).toContain('3×2');
    expect(row.querySelector('[title="Edit mosaic"]')).not.toBeNull();
    popup.__cleanup?.();
  });

  it('mosaic edit button: opens the modal pre-filled and saves via updateMosaic', async () => {
    seedPlan('s1', []);
    const plans = usePlansStore();
    (plans as any).plans[0].mosaics = [
      {
        id: 'm1',
        dsoId: 'M42',
        name: 'My region',
        centerRa: 83.8,
        centerDec: -5.4,
        paDeg: 0,
        overlapPct: 20,
        cols: 3,
        rows: 2,
      },
    ];
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const spy = vi.spyOn(plans, 'updateMosaic').mockResolvedValue();

    const popup = buildFovPopup(() => {});
    (popup.querySelector('[title="Edit mosaic"]') as HTMLButtonElement).click();

    // Modal opens with the "Edit mosaic" title and the mosaic's current grid.
    const modal = document.querySelector('.modal-backdrop .modal')!;
    expect(modal.querySelector('h2')!.textContent).toBe('Edit mosaic');
    const nums = Array.from(modal.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    expect(nums.map((i) => i.value)).toEqual(['20', '3', '2']); // overlap, cols, rows
    // Name pre-filled from the stored mosaic name (first text input).
    const nameInput = modal.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput.value).toBe('My region');

    (modal.querySelector('.btn-confirm') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('p1');
    expect(spy.mock.calls[0][1]).toBe('m1');
    // The single target stays anchored (dsoId set) and the name is forwarded.
    expect((spy.mock.calls[0][2] as any).dsoId).toBe('M42');
    expect((spy.mock.calls[0][2] as any).name).toBe('My region');
    popup.__cleanup?.();
  });

  it('create mosaic: blocks on an empty name and target, outlining both inputs', async () => {
    seedPlan('s1', []);
    const store = useFovFramesStore();
    await store.loadSpecs();
    store.setSelection({ kind: 'plan', planId: 'p1' });
    const plans = usePlansStore();
    const spy = vi.spyOn(plans, 'createMosaic').mockResolvedValue('m9');

    const popup = buildFovPopup(() => {});
    const addBtn = Array.from(popup.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Add a mosaic',
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    addBtn.click();

    const modal = document.querySelector('.modal-backdrop .modal')!;
    expect(modal.querySelector('h2')!.textContent).toBe('New mosaic');
    (modal.querySelector('.btn-confirm') as HTMLButtonElement).click();

    expect(spy).not.toHaveBeenCalled();
    expect(
      (modal.querySelector('input[type="text"]') as HTMLElement).classList.contains('input-error'),
    ).toBe(true);
    // Both the name and target error messages are revealed.
    expect(modal.querySelectorAll('.input-error-msg:not(.hidden)').length).toBe(2);
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
    expect(popup.querySelector('.fov-popup-setup-row .flex-1')!.getAttribute('title')).toBe(
      'Center on map',
    );
    popup.__cleanup?.();
  });
});
