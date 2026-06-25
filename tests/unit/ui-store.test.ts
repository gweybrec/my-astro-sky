import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore, SKY_TOOLTIP_GRACE_MS } from '../../src/stores/ui';

describe('ui store — sky tooltip grace period', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('showSkyTooltip sets html/position immediately', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('<b>M42</b>', 100, 200);
    expect(ui.skyTooltipHtml).toBe('<b>M42</b>');
    expect(ui.skyTooltipX).toBe(100);
    expect(ui.skyTooltipY).toBe(200);
  });

  it('requestHideSkyTooltip clears html only after the grace period', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 0, 0);
    ui.requestHideSkyTooltip();
    // Still visible right up until the grace period elapses.
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS - 1);
    expect(ui.skyTooltipHtml).toBe('M42');
    vi.advanceTimersByTime(1);
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('keepSkyTooltipAlive cancels a pending hide so it persists past the grace period', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 0, 0);
    ui.requestHideSkyTooltip();
    ui.keepSkyTooltipAlive();
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS * 4);
    expect(ui.skyTooltipHtml).toBe('M42');
  });

  it('showSkyTooltip cancels a pending hide (re-hovering an object)', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 0, 0);
    ui.requestHideSkyTooltip();
    ui.showSkyTooltip('M31', 10, 20);
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS * 2);
    expect(ui.skyTooltipHtml).toBe('M31');
  });

  it('does not restart an already-pending hide timer', () => {
    const ui = useUiStore();
    ui.showSkyTooltip('M42', 0, 0);
    ui.requestHideSkyTooltip();
    // Drifting over empty sky fires more hide requests — they must not extend the window.
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS - 50);
    ui.requestHideSkyTooltip();
    ui.requestHideSkyTooltip();
    vi.advanceTimersByTime(50);
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('requestHideSkyTooltip is a no-op when no tooltip is shown', () => {
    const ui = useUiStore();
    ui.requestHideSkyTooltip();
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS * 2);
    expect(ui.skyTooltipHtml).toBeNull();
  });

  it('setSkyTooltip shim: html shows, null hides gracefully', () => {
    const ui = useUiStore();
    ui.setSkyTooltip('M42', 5, 6);
    expect(ui.skyTooltipHtml).toBe('M42');
    ui.setSkyTooltip(null, 0, 0);
    expect(ui.skyTooltipHtml).toBe('M42'); // still visible during grace
    vi.advanceTimersByTime(SKY_TOOLTIP_GRACE_MS);
    expect(ui.skyTooltipHtml).toBeNull();
  });
});
