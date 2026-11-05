import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import WcsConflictDialog from '../../src/components/modals/WcsConflictDialog.vue';
import type { WcsChange } from '@myastrosky/core/photo-metadata-draft';

const conflicts: WcsChange[] = [
  { key: 'observationDate', current: '2023-05-05T00:00:00Z', incoming: '2024-01-02T03:04:05Z' },
  { key: 'capture.gain', field: 'gain', current: 100, incoming: 200 },
];

const mountDialog = () =>
  mount(WcsConflictDialog, { props: { conflicts }, attachTo: document.body });
const applyBtn = (w: ReturnType<typeof mountDialog>) => w.find('button.btn-confirm');

describe('WcsConflictDialog', () => {
  it('lists each conflict with its current and new value, all ticked', () => {
    const w = mountDialog();
    const rows = w.findAll('[data-test="wcs-conflict-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].text()).toContain('100 → 200');
    expect(rows.every((r) => (r.find('input').element as HTMLInputElement).checked)).toBe(true);
    w.unmount();
  });

  it('applies only the ticked values', async () => {
    const w = mountDialog();
    await w.findAll('[data-test="wcs-conflict-row"] input')[0].trigger('change');
    await applyBtn(w).trigger('click');
    expect(w.emitted('apply')?.[0]).toEqual([[conflicts[1]]]);
    w.unmount();
  });

  it('unticks and reticks everything from the select-all box', async () => {
    const w = mountDialog();
    const all = w.find('[data-test="wcs-conflicts-all"]');
    (all.element as HTMLInputElement).checked = false;
    await all.trigger('change');
    await applyBtn(w).trigger('click');
    expect(w.emitted('apply')?.[0]).toEqual([[]]);
    (all.element as HTMLInputElement).checked = true;
    await all.trigger('change');
    await applyBtn(w).trigger('click');
    expect(w.emitted('apply')?.[1]).toEqual([conflicts]);
    w.unmount();
  });

  it('cancels with the Cancel button and with Escape', async () => {
    const w = mountDialog();
    await w.find('button.btn-cancel').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('cancel')).toHaveLength(2);
    w.unmount();
  });
});
