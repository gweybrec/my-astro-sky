/**
 * Tests for @myastrosky/core/data-credits: the credits the desktop's "Crédits des données" window and the phone's page
 * share, in three sections, with every link and licence page an https address.
 */
import { describe, it, expect } from 'vitest';
import { dataCreditSections } from '@myastrosky/core/data-credits';
import { t } from '@myastrosky/core/i18n/index';

describe('dataCreditSections', () => {
  it('lists the catalogues, the reference documents and the online data, in that order', () => {
    const sections = dataCreditSections();
    expect(sections.map((s) => s.label)).toEqual([
      t('settings.dataCreditsCatalogsLabel'),
      t('settings.dataCreditsDocsLabel'),
      t('settings.dataCreditsOnlineLabel'),
    ]);
    expect(sections.map((s) => s.credits.length)).toEqual([7, 3, 2]);
  });

  it('says only of the online data that it is downloaded, not shipped', () => {
    expect(dataCreditSections().map((s) => s.intro)).toEqual([
      undefined,
      undefined,
      t('settings.dataCreditsOnlineIntro'),
    ]);
  });

  it('credits OpenStreetMap under the ODbL and the elevation sources by their attribution page', () => {
    const [osm, elevation] = dataCreditSections()[2].credits;
    expect(osm).toMatchObject({
      name: 'Peak names — OpenStreetMap',
      detail: expect.stringContaining('© OpenStreetMap contributors'),
      url: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL 1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    });
    expect(elevation.url).toBe('https://github.com/tilezen/joerd/blob/master/docs/attribution.md');
    expect(elevation.license).toBeUndefined();
  });

  it('translates the licences without a name of their own and the Large PN note', () => {
    const credits = dataCreditSections().flatMap((s) => s.credits);
    const byName = (name: string) => credits.find((c) => c.name === name)!;
    expect(byName('Constellation boundaries').license).toBe(
      t('settings.dataCreditsLicensePublicDomain'),
    );
    expect(byName('The 750 Best Deep Sky Objects').license).toBe(
      t('settings.dataCreditsLicenseAllRights'),
    );
    expect(byName('Large PN Observing Atlas').note).toBe(t('settings.dataCreditsLargePnNote'));
  });

  it('gives every link a text and keeps names unique (the lists are keyed by name)', () => {
    const credits = dataCreditSections().flatMap((s) => s.credits);
    expect(new Set(credits.map((c) => c.name)).size).toBe(credits.length);
    for (const c of credits) {
      if (c.url) {
        expect(c.url).toMatch(/^https:\/\//);
        expect(c.linkText).toBeTruthy();
      }
      if (c.licenseUrl) {
        expect(c.licenseUrl).toMatch(/^https:\/\//);
        expect(c.license).toBeTruthy();
      }
    }
  });
});
