import type { Translations } from '../fr';

const de: Translations['mobile'] = {
  info: { label: 'Information: {title}' },
  tabs: { sky: 'Himmel', targets: 'Ziele', navLabel: 'Navigation' },
  gallery: { searchLabel: 'Foto suchen', empty: 'Noch keine Fotos' },
  plans: { searchPlaceholder: 'Plan suchen…', searchLabel: 'Plan suchen' },
  targets: {
    searchPlaceholder: 'Ziel suchen…',
    searchLabel: 'Ziel suchen',
    tonight: 'Heute Nacht',
  },
  settings: {
    observation: 'Beobachtung',
    setups: 'Setups',
    astrometryKey: 'astrometry.net-Schlüssel',
    computerSection: 'Computer und Daten',
    computerConnection: 'Verbindung zum Computer',
    exportImport: 'Daten exportieren / importieren',
    about: 'Info',
    langFr: 'Français',
    langEn: 'English',
    langEs: 'Español',
    langDe: 'Deutsch',
    themeValue: 'Kühl modern',
    keyConfigured: '✓ Konfiguriert',
    lan: 'LAN',
  },
  nav: { back: 'Zurück' },
  gear: {
    addTelescope: 'Teleskop hinzufügen',
    aperture: 'Öffnung {mm} mm',
    focal: 'Brennweite {mm} mm',
    searchTelescope: 'Teleskop suchen…',
    searchTelescopeLabel: 'Teleskop suchen',
    searchCamera: 'Kamera suchen…',
    searchCameraLabel: 'Kamera suchen',
    searchAccessory: 'Zubehör suchen…',
    searchAccessoryLabel: 'Zubehör suchen',
    summary: 'Effektive Brennweite: {value}',
  },
  location: { horizonSection: 'Geländehorizont', dms: 'DMS (° ′ ″)' },
  backup: { exportSection: 'Exportieren', importSection: 'Importieren' },
};

export default de;
