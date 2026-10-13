// The rules file of the phone app (apps/mobile). A rules file is all `run.mjs <name>` needs to check an app; the engine
// (`../scripts/engine.mjs`) knows no app. A second app is a second file in this folder, with the same exports:
//   name        the app's name (the file's name)
//   prepare     commands run once before the servers: [{ args, cwd }] (node arguments)
//   servers     ({ ports, tmp }) => the processes to start, in order: [{ name, args, cwd, env, ready }]; ports are free
//               ones chosen by the runner, tmp is a new empty folder it deletes afterwards
//   baseUrl     ({ ports }) => the address the views are opened on
//   seed        async ({ ports }) => { ids, storage }: fills the app's data through its API; `storage` are the
//               localStorage entries to set before a page loads; `ids` are passed to the views' paths
//   cachedPrefixes  address prefixes whose GET answers are kept after the first time (a server with a rate limit)
//   language    { key, all }: the storage key of the language, and the languages to try (the first is the default)
//   sizes       the viewport sizes [width, height]
//   rules       the measurements: { id, type, ...selectors } (types are in the engine; `minimum: true` for a gap)
//   views       the pages: { name, path (string or ids => string), ready?, open?, scope?, variants? }; `open` is a list of
//               { click: selector } | { fill: selector, text } | { wait: selector } | { pause: ms }; `scope` limits the measure to one element
//               (an open sheet); `clearStorage` is a list of storage keys removed before the page loads (a first start);
//               `variants: true` repeats the view in every language and at 130 % text.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const node = (...parts) => path.join(repo, ...parts);

export const name = 'mobile';

export const prepare = [{ args: [node('apps/mobile/scripts/copy-bundled.mjs')], cwd: repo }];

export const servers = ({ ports, tmp }) => [
  {
    name: 'the desktop server',
    args: [node('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    cwd: repo,
    env: {
      PORT: String(ports[0]),
      DB_PATH: path.join(tmp, 'data.db'),
      UPLOADS_DIR: path.join(tmp, 'uploads'),
    },
    ready: `http://127.0.0.1:${ports[0]}/api/plans`,
  },
  {
    name: 'the phone app',
    args: [
      node('node_modules/vite/bin/vite.js'),
      'apps/mobile',
      '--port',
      String(ports[1]),
      '--strictPort',
    ],
    cwd: repo,
    env: { MOBILE_API_TARGET: `http://127.0.0.1:${ports[0]}` },
    ready: `http://localhost:${ports[1]}/`,
  },
];

export const baseUrl = ({ ports }) => `http://localhost:${ports[1]}`;

// A photo placed over the north celestial pole (three stars 20° from it, 120° apart), so that a tap at the middle of the map
// lands on it.
async function uploadPhoto(base, fileName = 'Cygnus_wide_2025-08-23.jpg') {
  const sharp = (await import('sharp')).default;
  const width = 400;
  const height = 300;
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 70, b: 120 } },
  })
    .jpeg()
    .toBuffer();
  const stars = [
    [200, 40, 0],
    [80, 230, 120],
    [320, 230, 240],
  ];
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), fileName);
  form.append(
    'correspondences',
    JSON.stringify(
      stars.map(([x, y, ra], i) => ({
        pointIndex: i,
        photoX: x,
        photoY: y,
        starHip: 0,
        starName: `Étoile ${i + 1}`,
        starRa: ra,
        starDec: 70,
      })),
    ),
  );
  form.append(
    'dsoIds',
    JSON.stringify([
      'NGC7000',
      'IC5070',
      'NGC6888',
      'NGC6910',
      'SH2-112',
      'SH2-106',
      'SH2-109',
      'SH2-108',
      'LBN270',
      'NGC6960',
    ]),
  );
  const res = await fetch(`${base}/api/photos`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`POST /api/photos answered ${res.status}`);
  return res.json();
}

const api = async (base, method, route, body) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}`);
  return res.json();
};

export async function seed({ ports }) {
  const base = `http://127.0.0.1:${ports[0]}`;
  const lat = 48.58;
  const lon = 7.75;
  const night = new Date().toISOString().slice(0, 10);

  const setup1 = await api(base, 'POST', '/api/gear-setups', {
    name: 'Newton 200 + ASI 183',
    telescopeId: 'celestron-c8-sct',
    cameraId: 'zwo-asi183mc',
    accessoryId: null,
    enabled: true,
  });
  const setup2 = await api(base, 'POST', '/api/gear-setups', {
    name: 'C6 + ASI 178',
    telescopeId: 'celestron-c6-sct',
    cameraId: 'zwo-asi178mc',
    accessoryId: null,
    enabled: true,
  });

  const makePlan = async (planName, setupId, dsoIds) => {
    const plan = await api(base, 'POST', '/api/plans', { name: planName });
    await api(base, 'PUT', `/api/plans/${plan.id}`, { nightOf: night, setupId, lat, lon });
    const entries = {};
    for (const dsoId of dsoIds) {
      entries[dsoId] = (await api(base, 'POST', `/api/plans/${plan.id}/entries`, { dsoId })).id;
    }
    return { id: plan.id, entries };
  };
  const summer = await makePlan('Nuit d’été', setup1.id, [
    'M42',
    'NGC7000',
    'SH2-308',
    'M31',
    'M13',
  ]);
  const spring = await makePlan('Galaxies de printemps', setup2.id, ['M101', 'M45', 'M27']);

  const windows = (ids) =>
    ids.map((id, i) => ({
      id,
      startFrac: 0.1 + i * 0.35,
      endFrac: 0.4 + i * 0.35,
      filter: i === 0 ? 'Ha' : null,
      color: null,
      frameSeconds: 180,
      snap: true,
    }));
  await api(base, 'PATCH', `/api/plans/${summer.id}/entries/${summer.entries.NGC7000}`, {
    observationWindows: windows(['w1', 'w2']),
  });
  await api(base, 'PATCH', `/api/plans/${summer.id}/entries/${summer.entries.M42}`, {
    observationWindows: windows(['w3']),
  });

  const firstPhoto = await uploadPhoto(base);
  const photoId = (firstPhoto.photo ?? firstPhoto).id;
  // What the photo's information sheet lists: a date, two integrations with their filters, an equipment. The objects
  // are sent again: the route replaces the ones it is not given by none.
  await api(base, 'PATCH', `/api/photos/${photoId}/metadata`, {
    dsoIds: (firstPhoto.photo ?? firstPhoto).dsoIds,
    observationDate: '2025-08-23T21:30:00.000Z',
    integrations: [
      { frames: 60, seconds: 180, filter: 'Ha' },
      { frames: 20, seconds: 240, filter: 'OIII' },
    ],
    gearSetupId: setup1.id,
    // What the gallery card adds to its chips: a label and a point of interest.
    labels: ['LRGB'],
    pointsOfInterest: [{ name: 'C/2023 A3', categoryId: 'cat-comet' }],
    // What the photo's edit page adds: capture details (one with a unit, one that is text) and notes.
    captureDetails: { gain: 100, ccdTemp: -10, binning: '1x1' },
    notes: 'Seeing moyen',
  });
  // Twelve photos: six rows of the gallery's two columns in portrait, two rows of its six columns in landscape.
  for (const fileName of [
    'Cygnus_close_2025-08-24.jpg',
    'Lyra_2025-08-25.jpg',
    'Lacerta_2025-08-26.jpg',
    'Cepheus_2025-08-27.jpg',
    'Draco_2025-08-28.jpg',
    'Cassiopeia_2025-08-29.jpg',
    'Andromeda_2025-08-30.jpg',
    'Pegasus_2025-08-31.jpg',
    'Perseus_2025-09-01.jpg',
    'Auriga_2025-09-02.jpg',
    'Taurus_2025-09-03.jpg',
  ]) {
    await uploadPhoto(base, fileName);
  }

  await api(base, 'POST', '/api/sky-regions', {
    name: 'Zone dégagée',
    color: '#4aa3ff',
    points: [
      { azDeg: 100, altDeg: 30 },
      { azDeg: 160, altDeg: 30 },
      { azDeg: 160, altDeg: 70 },
      { azDeg: 100, altDeg: 70 },
    ],
  });

  const prefs = { setupId: setup1.id, lastDateISO: null, lat, lon };
  return {
    ids: {
      setup: setup1.id,
      photo: photoId,
      plan: summer.id,
      entry: summer.entries.NGC7000,
      longEntry: summer.entries['SH2-308'],
    },
    storage: { 'targets-prefs-v3': JSON.stringify(prefs) },
  };
}

// Read-only calls answered from memory after the first time: the server refuses more than 300 requests a minute.
export const cachedPrefixes = ['/api/'];

export const language = { key: 'lang', all: ['fr', 'en', 'es', 'de'] };

export const sizes = [
  [384, 832],
  [412, 915],
  [832, 384],
];

const ROWS =
  'ion-item.mob-row, ion-toggle.mob-row, ion-radio.mob-row, ion-checkbox.mob-row, .mob-entry';
const SWITCH_TRACK = '.toggle-icon-wrapper, .native-wrapper';

export const rules = [
  // Text and the text inside a chip or badge of the same line share a baseline.
  {
    id: 'baseline',
    type: 'baseline',
    lines: '.mob-meta',
    chips: 'ion-badge, ion-chip, .mob-badge, .mob-chip',
  },
  // An icon, a switch or an "i" button is centred on its row.
  {
    id: 'icon-centre',
    type: 'rowCentre',
    rows: ROWS,
    items:
      '.mob-row-lead, .mob-row-thumb, .mob-row-chevron, .mob-drag svg, .mob-btn-caret, .mob-icon-btn, .mob-check',
    track: SWITCH_TRACK,
  },
  // A row's content has the same room above and below.
  { id: 'room', type: 'room', rows: ROWS, track: SWITCH_TRACK },
  // An icon alone in its box is centred in it.
  {
    id: 'box-centre',
    type: 'boxCentre',
    boxes: '.mob-drag, .mob-icon-btn, .mob-fab, ion-fab-button, .mob-btn--icon',
    icon: 'svg',
  },
  // An icon after a text is centred on the text's line.
  { id: 'icon-text', type: 'iconOnLine', lines: '.mob-fact-value', icon: 'svg' },
  // Items side by side in a bar, a footer, a field row share their centre line.
  {
    id: 'centre-line',
    type: 'centreLine',
    bars: '.mob-topbar, .mob-sheet-footer, .mob-footer, .mob-input-row, .phone-field-unit-line, .mob-icon-row, .mob-map-top, .mob-timebar',
  },
  // The clear button of a search field is centred on the field.
  { id: 'search-clear', type: 'rowCentre', rows: '.mob-search-wrap', items: '.mob-search-clear' },
  // A card's label and value start on one line; the toggles of the map's column start on one line.
  {
    id: 'fact-edge',
    type: 'sameStart',
    bars: '.mob-fact',
    children: '.mob-fact-label, .mob-fact-value',
  },
  { id: 'ribbon-edge', type: 'sameStart', bars: '.mob-map-ribbon', children: 'ion-button' },
  // The object sheet's cards and buttons span the same width, between the same two edges as its title.
  {
    id: 'sheet-edges',
    type: 'edges',
    within: '.mob-map-sheet, .mob-sheet',
    lefts:
      '.mob-fact:first-child, .mob-icon-row > :first-child, .mob-pager-page:first-child > :first-child, .mob-slider-label',
    rights: '.mob-fact:last-child, .mob-icon-row:not(.mob-icon-row--start) > :last-child',
  },
  // The gallery's tiles make columns between the same two edges: two in portrait, six in landscape. The first tile of
  // every sixth is in the first column in both, and the sixth of every six in the last.
  {
    id: 'grid-edges',
    type: 'edges',
    within: '.mob-photo-grid',
    lefts: '.mob-photo:nth-child(6n + 1)',
    rights: '.mob-photo:nth-child(6n)',
  },
  // In a gallery card, the photo's name and its first chip start on one line.
  {
    id: 'card-edge',
    type: 'edges',
    within: '.mob-photo-card',
    lefts: '.mob-photo-card-name, .mob-tags > :first-child',
  },
  // On the map, the layers button and the column of toggles end on the same line, and the toggles are equally spaced
  // (the last one, set apart, is the only exception: it is measured against its own margin).
  {
    id: 'map-edges',
    type: 'edges',
    within: '.mob-map',
    rights: '.mob-map-top > ion-button:last-child, .mob-map-ribbon > ion-button',
  },
  // Every button is a touch target of at least 48 by 48.
  {
    id: 'touch-size',
    type: 'touchSize',
    items: 'ion-button.mob-btn, ion-button.mob-icon-btn, .mob-search-clear, .mob-sheet-grab',
    min: 'var(--mobile-touch-min)',
    minimum: true,
    word: 'too small',
  },
  { id: 'icon-row-gaps', type: 'equalGaps', bars: '.mob-icon-row, .mob-timebar' },
  // A tab bar's buttons start on the same line.
  { id: 'tab-line', type: 'sameStart', bars: 'ion-tab-bar', children: 'ion-tab-button' },
  // An "i" button and the switch beside it are apart by at least the spacing token.
  {
    id: 'gap',
    type: 'gap',
    rows: 'ion-toggle.mob-toggle-row--info',
    first: '.mob-icon-btn',
    track: SWITCH_TRACK,
    gap: 'var(--space-4)',
    minimum: true,
  },
  // The first column's titles, headers and helper lines start on one line (not the second field of a pair).
  {
    id: 'left-edge',
    type: 'leadingEdge',
    items:
      '.mob-section-header, .mob-sheet-title, .mob-form-label:not(.mob-form-row--pair > :not(:first-child) *), .mob-helper, ion-item.mob-row:not(:has(.mob-row-lead)):not(.mob-entry .mob-row) .mob-row-title, ion-toggle.mob-row .mob-row-title',
  },
  // The chevron (else the switch) of each row ends on one line.
  {
    id: 'right-edge',
    type: 'trailingEdge',
    rows: 'ion-item.mob-row, ion-toggle.mob-row',
    skip: '.mob-entry',
    end: '.mob-row-chevron',
    track: SWITCH_TRACK,
  },
  // An empty state's content is centred.
  { id: 'centred', type: 'centredBlock', boxes: '.mob-empty, .mob-map-prompt' },
];

const SHEET = { scope: '.mob-sheet' };

export const views = [
  {
    name: 'components',
    path: '/dev/components',
    ready: '.mob-meta ion-badge',
    variants: true,
  },
  { name: 'targets', path: '/tabs/targets', ready: '.mob-row--roomy' },
  {
    name: 'targets-types',
    path: '/tabs/targets',
    ready: '.mob-row--roomy',
    open: [{ click: '.mob-context-types' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  {
    name: 'targets-settings',
    path: '/tabs/targets',
    ready: '.mob-row--roomy',
    open: [{ click: '.mob-topbar ion-button.mob-icon-btn:first-of-type' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  {
    name: 'targets-filters',
    path: '/tabs/targets',
    ready: '.mob-row--roomy',
    open: [{ click: '.mob-topbar ion-button.mob-icon-btn:last-of-type' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  { name: 'sky', path: '/tabs/sky', ready: '.mob-map-top' },
  {
    name: 'sky-layers',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The calendar button puts the map in the date mode: the time bar and the toggles appear.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-map-ribbon' },
      { wait: '.mob-timebar' },
    ],
  },
  {
    name: 'sky-display',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [{ click: '.mob-map-top ion-button:nth-of-type(1)' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  {
    name: 'sky-first-start',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    clearStorage: ['targets-prefs-v3', 'sky-time-settings'],
    open: [{ wait: '.mob-map-prompt' }],
  },
  {
    name: 'sky-photo',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      { wait: '.photo-overlay-img' },
      { pause: 800 },
      { tapCentre: '.mob-sky-canvas' },
      { wait: '.mob-map-sheet' },
      { pause: 600 },
    ],
  },
  { name: 'sky-search', path: '/sky/search', ready: '.mob-search-wrap' },
  {
    name: 'sky-search-results',
    path: '/sky/search',
    ready: '.mob-search-wrap',
    open: [{ fill: '.mob-search-wrap input', text: 'andro' }, { wait: '.mob-row--roomy' }],
  },
  {
    name: 'sky-star',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      { click: '.mob-map-top ion-input' },
      { wait: '.mob-search-wrap' },
      { fill: '.mob-search-wrap input', text: 'vega' },
      { wait: '.mob-row--roomy' },
      { click: '.mob-row--roomy' },
      { wait: '.mob-map-sheet' },
      { pause: 600 },
    ],
  },
  {
    name: 'sky-object',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      { click: '.mob-map-top ion-input' },
      { wait: '.mob-search-wrap' },
      { fill: '.mob-search-wrap input', text: 'andro' },
      { wait: '.mob-row--roomy' },
      { click: '.mob-row--roomy' },
      { wait: '.mob-map-sheet' },
      { pause: 600 },
    ],
  },
  { name: 'gallery', path: '/tabs/gallery', ready: '.mob-photo' },
  {
    name: 'gallery-display',
    path: '/tabs/gallery',
    ready: '.mob-photo',
    open: [
      { click: '.mob-topbar ion-button.mob-icon-btn:first-of-type' },
      { wait: '.mob-sheet' },
      { pause: 600 },
    ],
    ...SHEET,
  },
  {
    name: 'gallery-add',
    path: '/tabs/gallery',
    ready: '.mob-photo',
    open: [{ click: 'ion-fab-button' }, { wait: '.mob-sheet' }, { pause: 600 }],
    ...SHEET,
  },
  {
    // A solved FITS (placed by its own WCS) and a JPEG that still has to be placed: the files are the repository's
    // local test photos.
    name: 'gallery-import',
    path: '/tabs/gallery',
    ready: '.mob-photo',
    open: [
      { click: 'ion-fab-button' },
      { wait: '.mob-sheet' },
      { pause: 600 },
      {
        chooseFiles: '.mob-sheet ion-item.mob-row',
        files: ['test-photos/M1-CCD.fit', 'test-photos/M1-CCD.jpg'],
      },
      { wait: '.mob-status--success' },
    ],
  },
  { name: 'photo', path: (ids) => `/gallery/photo/${ids.photo}`, ready: '.mob-photo-view' },
  {
    name: 'photo-info',
    path: (ids) => `/gallery/photo/${ids.photo}`,
    ready: '.mob-photo-view',
    open: [
      { click: '.mob-topbar--overlay ion-button.mob-icon-btn:last-of-type' },
      { wait: '.mob-sheet' },
      { pause: 600 },
    ],
    ...SHEET,
  },
  {
    name: 'photo-edit',
    path: (ids) => `/gallery/photo/${ids.photo}/edit`,
    ready: '.mob-integration',
  },
  { name: 'plans', path: '/tabs/plans', ready: 'ion-item.mob-row' },
  { name: 'plan', path: (ids) => `/plans/${ids.plan}`, ready: '.mob-entry' },
  { name: 'plan-target', path: (ids) => `/plans/${ids.plan}/${ids.entry}`, ready: '.mob-meta' },
  {
    name: 'plan-target-long-name',
    path: (ids) => `/plans/${ids.plan}/${ids.longEntry}`,
    ready: '.mob-meta',
  },
  {
    name: 'observation-window',
    path: (ids) => `/plans/${ids.plan}/${ids.entry}`,
    ready: '.mob-meta',
    open: [{ click: 'ion-item.mob-row:has(.mob-swatch)' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  { name: 'settings', path: '/tabs/settings', ready: 'ion-item.mob-row' },
  { name: 'setups', path: '/settings/setups', ready: 'ion-item.mob-row' },
  { name: 'setup', path: (ids) => `/settings/setups/${ids.setup}`, ready: '.mob-form-row' },
  { name: 'location', path: '/settings/location', ready: '.mob-form-row' },
  { name: 'backup', path: '/settings/backup', ready: 'ion-checkbox.mob-row' },
];
