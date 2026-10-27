/**
 * Tests for DataCreditsModal.vue: the shared credits in their three sections, the line under the online data, and the
 * links and licence chips of a row.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DataCreditsModal from '../../src/components/modals/DataCreditsModal.vue';
import { t } from '@myastrosky/core/i18n/index';

function texts(selector: string): string[] {
  return Array.from(document.body.querySelectorAll(selector)).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

function row(name: string): Element {
  return Array.from(document.body.querySelectorAll('.dep-row')).find(
    (r) => r.querySelector('.dep-name')?.textContent?.trim() === name,
  )!;
}

describe('DataCreditsModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the three sections, with the line under the online data only', () => {
    const w = mount(DataCreditsModal, { attachTo: document.body });
    expect(texts('.credits-section-label')).toEqual([
      t('settings.dataCreditsCatalogsLabel'),
      t('settings.dataCreditsDocsLabel'),
      t('settings.dataCreditsOnlineLabel'),
    ]);
    expect(texts('.credits-section-intro')).toEqual([t('settings.dataCreditsOnlineIntro')]);
    expect(texts('.dep-name')).toHaveLength(12);
    w.unmount();
  });

  it('links a row and its licence, and shows a licence without a page as a plain chip', () => {
    const w = mount(DataCreditsModal, { attachTo: document.body });
    const osm = row('Peak names — OpenStreetMap');
    expect(osm.querySelector('a.settings-link')?.getAttribute('href')).toBe(
      'https://www.openstreetmap.org/copyright',
    );
    expect(osm.querySelector('a.tag-chip-sm')?.getAttribute('href')).toBe(
      'https://opendatacommons.org/licenses/odbl/1-0/',
    );
    const boundaries = row('Constellation boundaries');
    expect(boundaries.querySelector('a')).toBeNull();
    expect(boundaries.querySelector('span.tag-chip-sm')?.textContent).toBe(
      t('settings.dataCreditsLicensePublicDomain'),
    );
    expect(row('Large PN Observing Atlas').querySelector('.dep-note')?.textContent).toBe(
      t('settings.dataCreditsLargePnNote'),
    );
    w.unmount();
  });
});
