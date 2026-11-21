import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backend calls the Find targets form makes while it is built.
const getGearSetups = vi.fn();
vi.mock('../../src/api', () => ({
  getGearSetups: (...args: unknown[]) => getGearSetups(...args),
  getPhotos: vi.fn().mockResolvedValue([]),
  getPlans: vi.fn().mockResolvedValue([]),
  getSkyRegions: vi.fn().mockResolvedValue([]),
  createCustomGear: vi.fn(),
  deleteCustomGear: vi.fn(),
}));
vi.mock('@myastrosky/app-state/api', () => ({
  getPlans: vi.fn().mockResolvedValue([]),
  getSkyRegions: vi.fn().mockResolvedValue([]),
  getGearSetups: (...args: unknown[]) => getGearSetups(...args),
}));
vi.mock('@myastrosky/core/gear-catalog', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTelescopes: vi.fn().mockResolvedValue([]),
  getCameras: vi.fn().mockResolvedValue([]),
  getAccessories: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/error-reporter', () => ({ reportUnknownRendererError: vi.fn() }));

import { buildNightDateField } from '../../src/targets-view';
import { formatPlanDate } from '@myastrosky/core/targets/plan';
import { todayISO } from '@myastrosky/core/targets/format';
import { getLang } from '../../src/i18n';

function open(field: HTMLElement): HTMLElement {
  document.body.appendChild(field);
  field.querySelector<HTMLButtonElement>('[data-test=night-field]')!.click();
  return field.querySelector<HTMLElement>('[data-test=date-picker]')!;
}

describe('buildNightDateField', () => {
  it('shows the night and opens a day-only calendar with Today, Cancel and OK, no clear', () => {
    const field = buildNightDateField('2026-11-21', vi.fn());
    expect(field.textContent).toContain(formatPlanDate('2026-11-21', getLang()));
    const picker = open(field);
    expect(picker.querySelector('[data-test=hour]')).toBeNull();
    const buttons = [...picker.querySelectorAll('[data-test^=date-]')].map((b) =>
      b.getAttribute('data-test'),
    );
    expect(buttons).toEqual(['date-today', 'date-cancel', 'date-ok']);
  });

  it('passes on a picked day and shows it', async () => {
    const onPick = vi.fn();
    const field = buildNightDateField('2026-11-21', onPick);
    const picker = open(field);
    const day3 = [...picker.querySelectorAll<HTMLButtonElement>('[data-test=day]')].find(
      (d) => d.textContent?.trim() === '3' && d.className.includes('text-secondary'),
    )!;
    day3.click();
    await Promise.resolve();
    picker.querySelector<HTMLButtonElement>('[data-test=date-ok]')!.click();
    expect(onPick).toHaveBeenCalledWith('2026-11-03');
    expect(field.querySelector('[data-test=date-picker]')).toBeNull();
    expect(field.textContent).toContain(formatPlanDate('2026-11-03', getLang()));
  });

  it('Today picks today at once; Cancel and Escape keep the night', () => {
    const onPick = vi.fn();
    const field = buildNightDateField('2020-01-01', onPick);
    open(field).querySelector<HTMLButtonElement>('[data-test=date-cancel]')!.click();
    open(field);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(field.querySelector('[data-test=date-picker]')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    open(field).querySelector<HTMLButtonElement>('[data-test=date-today]')!.click();
    expect(onPick).toHaveBeenCalledWith(todayISO());
  });
});
