/**
 * Tests for PrivacyModal.vue: the local-storage paragraph, then one block per feature that reaches an outside server
 * (astrometry.net, the horizon, the identifications), and the IP geolocation block only in the desktop app.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PrivacyModal from '../../src/components/modals/PrivacyModal.vue';
import { t } from '@myastrosky/core/i18n/index';

type ElectronWindow = Window & { electronAPI?: unknown };

function blockTitles(): string[] {
  return Array.from(document.body.querySelectorAll('.privacy-warning-title')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

describe('PrivacyModal', () => {
  afterEach(() => {
    delete (window as ElectronWindow).electronAPI;
    document.body.innerHTML = '';
  });

  it('shows the local storage text and a block for each online feature', () => {
    const w = mount(PrivacyModal, { attachTo: document.body });
    expect(document.body.textContent).toContain(t('settings.privacyLocal'));
    expect(blockTitles()).toEqual([
      t('settings.privacyAstrometryTitle'),
      t('settings.privacyHorizonTitle'),
      t('settings.privacyIdentifyTitle'),
    ]);
    expect(document.body.textContent).toContain(t('settings.privacyHorizon'));
    expect(document.body.textContent).toContain(t('settings.privacyIdentify'));
    w.unmount();
  });

  it('adds the IP geolocation block in the desktop app', () => {
    (window as ElectronWindow).electronAPI = {};
    const w = mount(PrivacyModal, { attachTo: document.body });
    expect(blockTitles()).toContain(t('settings.privacyGeolocTitle'));
    expect(document.body.textContent).toContain(t('settings.privacyGeoloc'));
    w.unmount();
  });
});
