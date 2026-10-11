import type { Translations } from '../fr';

const es: Translations['mobile'] = {
  info: { label: 'Información: {title}' },
  tabs: { sky: 'Cielo', targets: 'Objetivos', navLabel: 'Navegación' },
  gallery: { searchLabel: 'Buscar una foto', empty: 'Aún no hay fotos' },
  plans: { searchPlaceholder: 'Buscar un plan…', searchLabel: 'Buscar un plan' },
  targets: {
    searchPlaceholder: 'Buscar un objetivo…',
    searchLabel: 'Buscar un objetivo',
    tonight: 'Esta noche',
  },
  settings: {
    observation: 'Observación',
    setups: 'Setups',
    astrometryKey: 'Clave de astrometry.net',
    computerSection: 'Ordenador y datos',
    computerConnection: 'Conexión al ordenador',
    exportImport: 'Exportar / Importar datos',
    about: 'Acerca de',
    langFr: 'Français',
    langEn: 'English',
    langEs: 'Español',
    langDe: 'Deutsch',
    themeValue: 'Frío moderno',
    keyConfigured: '✓ Configurada',
    lan: 'LAN',
  },
  nav: { back: 'Atrás' },
  gear: {
    addTelescope: 'Añadir un telescopio',
    aperture: 'Apertura {mm} mm',
    focal: 'Distancia focal {mm} mm',
    searchTelescope: 'Buscar un telescopio…',
    searchTelescopeLabel: 'Buscar un telescopio',
    searchCamera: 'Buscar una cámara…',
    searchCameraLabel: 'Buscar una cámara',
    searchAccessory: 'Buscar un accesorio…',
    searchAccessoryLabel: 'Buscar un accesorio',
    summary: 'Distancia focal efectiva: {value}',
  },
  location: { horizonSection: 'Horizonte del relieve', dms: 'DMS (° ′ ″)' },
  backup: { exportSection: 'Exportar', importSection: 'Importar' },
};

export default es;
