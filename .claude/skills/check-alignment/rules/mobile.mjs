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
//   fixtures    [{ method, path, body }]: fixed JSON answers for the routes that would reach services outside (the
//               identifications' SkyBoT, TNS and MPC), so that a check never depends on them
//   language    { key, all }: the storage key of the language, and the languages to try (the first is the default)
//   sizes       the viewport sizes [width, height]
//   rules       the measurements: { id, type, ...selectors } (types are in the engine; `minimum: true` for a gap)
//   views       the pages: { name, path (string or ids => string), ready?, open?, scope?, variants? }; `open` is a list of
//               { click: selector } | { fill: selector, text } | { wait: selector } | { pause: ms } |
//               { tapAt: selector, x, y } (fractions of its box); `scope` limits the measure to one element
//               (an open sheet); `clearStorage` is a list of storage keys removed before the page loads (a first start);
//               `variants: true` repeats the view in every language and at 130 % text.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const node = (...parts) => path.join(repo, ...parts);

export const name = 'mobile';

// The check measures the built app, the files the phone runs: the development server loads the style sheets in another
// order, so a rule that loses to Ionic's only in the build (the reorder handle's `display`) passed there.
// Built in mode "check" (the components page is kept) into a folder of its own, never the app's `dist`.
const BUILT = path.join(os.tmpdir(), 'myastrosky-check-alignment-build');
export const prepare = [
  { args: [node('apps/mobile/scripts/copy-bundled.mjs')], cwd: repo },
  {
    args: [
      node('node_modules/vite/bin/vite.js'),
      'build',
      'apps/mobile',
      '--mode',
      'check',
      '--outDir',
      BUILT,
      '--emptyOutDir',
    ],
    cwd: repo,
  },
];

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
      'preview',
      'apps/mobile',
      '--outDir',
      BUILT,
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
const POLE_FRAME = {
  width: 400,
  height: 300,
  stars: [
    [200, 40, 0, 70],
    [80, 230, 120, 70],
    [320, 230, 240, 70],
  ],
};
// The frame of the comet C/2025 R2 (SWAN) on 2025-11-07 at 18:42 UTC (the core comet tests' photo): 1341 × 790 px at
// 2.36″ per pixel, north up, centred on RA 341.441°, Dec 2.273°.
const COMET_FRAME = {
  width: 1341,
  height: 790,
  stars: [
    [134.1, 79, 341.7929169, 2.4801556],
    [1206.9, 118.5, 341.0890831, 2.4542611],
    [670.5, 711, 341.441, 2.0658444],
  ],
};

async function uploadPhoto(base, fileName = 'Cygnus_wide_2025-08-23.jpg', frame = POLE_FRAME) {
  const sharp = (await import('sharp')).default;
  const { width, height } = frame;
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 70, b: 120 } },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), fileName);
  form.append(
    'correspondences',
    JSON.stringify(
      frame.stars.map(([x, y, ra, dec], i) => ({
        pointIndex: i,
        photoX: x,
        photoY: y,
        starHip: 0,
        starName: `Étoile ${i + 1}`,
        starRa: ra,
        starDec: dec,
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

  // A smart telescope with a mosaic mode: its frame's sheet has Largeur / Hauteur.
  const smartSetup = await api(base, 'POST', '/api/gear-setups', {
    name: 'Seestar S50',
    telescopeId: 'seestar-s50',
    cameraId: 'seestar-s50-camera',
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

  // A mosaic in the summer plan: what "Changer d’équipement" asks about when the plan's setup changes.
  // No object: a mosaic on one of the plan's objects would replace that object's frame (the views below use it).
  await api(base, 'POST', `/api/plans/${summer.id}/mosaics`, {
    dsoId: null,
    name: 'Amérique du Nord',
    centerRa: 314.7,
    centerDec: 44.3,
    paDeg: 0,
    overlapPct: 20,
    cols: 2,
    rows: 1,
    tiles: [
      { ra: 314.4, dec: 44.3, paDeg: 0 },
      { ra: 315.0, dec: 44.3, paDeg: 0 },
    ],
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
  ]) {
    await uploadPhoto(base, fileName);
  }
  // The twelfth: the photo of a comet, for the comet identification (its date puts C/2025 R2 in it).
  const comet = await uploadPhoto(base, 'Comet_C2025R2_2025-11-07.jpg', COMET_FRAME);
  const cometPhotoId = (comet.photo ?? comet).id;
  await api(base, 'PATCH', `/api/photos/${cometPhotoId}/metadata`, {
    dsoIds: [],
    observationDate: '2025-11-07T18:42:00.000Z',
  });

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
      cometPhoto: cometPhotoId,
      plan: summer.id,
      entry: summer.entries.NGC7000,
      longEntry: summer.entries['SH2-308'],
    },
    storage: {
      'targets-prefs-v3': JSON.stringify(prefs),
      // Two free frames: one pinned on M31, one floating in the middle of the map.
      'fov-frames-v1': JSON.stringify([
        {
          id: 'adhoc-m31',
          setupId: setup1.id,
          anchor: { kind: 'sky', ra: 10.68, dec: 41.27, dsoId: 'M31' },
          rotationDeg: 24,
        },
        {
          id: 'adhoc-smart',
          setupId: smartSetup.id,
          anchor: { kind: 'sky', ra: 83.82, dec: -5.39, dsoId: 'M42' },
          rotationDeg: 0,
          mosaicWDeg: 2.1,
          mosaicHDeg: 1.2,
        },
        {
          id: 'adhoc-float',
          setupId: setup2.id,
          anchor: { kind: 'screen', nx: 0.5, ny: 0.4 },
          rotationDeg: 0,
        },
      ]),
      // A free 2 × 2 mosaic on M33: its sheet has the Lignes / Colonnes steppers.
      'fov-adhoc-mosaics-v1': JSON.stringify([
        {
          id: 'adhoc-mosaic',
          setupId: setup1.id,
          dsoId: 'M33',
          name: null,
          centerRa: 23.46,
          centerDec: 30.66,
          paDeg: 0,
          overlapPct: 20,
          cols: 2,
          rows: 2,
          tiles: [
            { ra: 23.2, dec: 30.85, paDeg: 0 },
            { ra: 23.72, dec: 30.85, paDeg: 0 },
            { ra: 23.2, dec: 30.47, paDeg: 0 },
            { ra: 23.72, dec: 30.47, paDeg: 0 },
          ],
        },
      ]),
    },
  };
}

// Read-only calls answered from memory after the first time: the server refuses more than 300 requests a minute.
export const cachedPrefixes = ['/api/'];

// What SkyBoT, TNS and the MPC answer in the checks. The asteroids and the supernovae lie in the seed's first photo (over
// the pole: its centre is near RA 70°, Dec 82.3°), the comet's elements put it in the comet photo.
export const fixtures = [
  {
    method: 'POST',
    path: '/api/skybot/conesearch',
    body: {
      candidates: [
        ['1685', 'Toro', 'NEA>Apollo', 16.2, 1],
        ['2204', 'Lyyli', 'MB>Middle', 17.4, 2],
        ['7968', 'Elst-Pizarro', 'MB>Outer', 18.9, 120],
      ].map(([number, name, className, vMag, ephemErrArcsec], i) => ({
        number,
        name,
        raDeg: 69.97 + i * 0.4,
        decDeg: 82.25 - i * 0.05,
        className,
        vMag,
        ephemErrArcsec,
        distArcsec: 10 * (i + 1),
        dRaArcsecPerHour: 30,
        dDecArcsecPerHour: -5,
      })),
    },
  },
  {
    method: 'POST',
    path: '/api/tns/conesearch',
    body: {
      candidates: [
        {
          name: 'SN 2025rkx',
          raDeg: 69.966,
          decDeg: 82.251,
          type: 'SN Ia',
          classified: true,
          discoveryDate: '2025-08-20T03:12:00.000Z',
          discoveryMag: 17.3,
          hostName: 'NGC 2655',
          redshift: 0.0047,
          tnsUrl: 'https://www.wis-tns.org/object/2025rkx',
        },
        {
          name: 'AT 2025sab',
          raDeg: 315.934,
          decDeg: 77.47,
          type: null,
          classified: false,
          discoveryDate: '2025-08-24T22:40:00.000Z',
          discoveryMag: 18.2,
          hostName: null,
          redshift: null,
          tnsUrl: 'https://www.wis-tns.org/object/2025sab',
        },
      ],
    },
  },
  {
    method: 'GET',
    path: '/api/comets/elements',
    body: {
      comets: [
        {
          designation: 'C/2025 R2',
          name: 'C/2025 R2 (SWAN)',
          tpJd: 2460931.3087,
          q: 0.50428,
          e: 0.994162,
          peri: 308.3762,
          node: 335.3135,
          incl: 4.4729,
          h: 12.4,
          k: 4,
        },
      ],
    },
  },
];

export const language = { key: 'lang', all: ['fr', 'en', 'es', 'de'] };

export const sizes = [
  [384, 832],
  [412, 915],
  [832, 384],
];

const ROWS =
  'ion-item.mob-row, ion-toggle.mob-row, ion-radio.mob-row, ion-checkbox.mob-row, .mob-entry, .mob-check-lead-row';
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
  // A tick box in a row's lead holder (PhoneCheckLeadRow) is centred in it.
  {
    id: 'lead-check',
    type: 'boxCentre',
    boxes: '.mob-check-lead-row > .mob-row-lead',
    icon: 'ion-checkbox',
  },
  // An icon after a text is centred on the text's line.
  { id: 'icon-text', type: 'iconOnLine', lines: '.mob-fact-value', icon: 'svg' },
  // The spinner of a busy button is centred on its label's line.
  {
    id: 'busy-spinner',
    type: 'iconOnLine',
    lines: 'ion-button.mob-btn--busy .mob-btn-content',
    icon: 'ion-spinner',
  },
  // Items side by side in a bar, a footer, a field row share their centre line.
  {
    id: 'centre-line',
    type: 'centreLine',
    bars: '.mob-topbar, .mob-sheet-footer, .mob-footer, .mob-input-row, .mob-stepper-row, .phone-field-unit-line, .mob-icon-row, .mob-map-top, .mob-timebar, .mob-when-row, .mob-form-row--search, .mob-type-row, .mob-add-row',
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
  // The object sheet's facts and buttons start at the same edge as its title; its buttons end at the same edge too
  // (facts are as wide as their text since design system revision 24).
  {
    id: 'sheet-edges',
    type: 'edges',
    within: '.mob-map-sheet, .mob-sheet',
    lefts:
      '.mob-fact:first-child, .mob-icon-row > :first-child, .mob-pager-page:first-child > :first-child, .mob-slider-label',
    rights: '.mob-icon-row:not(.mob-icon-row--start) > :last-child',
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
  // The first column's titles, headers and helper lines start on one line (not the second field of a pair); a row that
  // starts with a picture placeholder starts with it.
  {
    id: 'left-edge',
    type: 'leadingEdge',
    items:
      '.mob-section-header, .mob-sheet-title, .mob-stepper-label, .mob-form-label:not(.mob-form-row--pair > :not(:first-child) *), .mob-helper, ion-item.mob-row:not(:has(.mob-row-lead, .mob-row-thumb)):not(.mob-entry .mob-row) .mob-row-title, ion-item.mob-row:not(.mob-entry .mob-row) .mob-row-thumb, ion-toggle.mob-row .mob-row-title',
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
// The sheet of the modal that is open, when the map's own sheet or other (closed) modals are also on the page.
const OPEN_SHEET = 'ion-modal.show-modal .mob-sheet';
// A tap at the middle of the map picks the seed's photo; its sheet's button opens the display order page.
const DRAW_ORDER_OPEN = [
  { wait: '.photo-overlay-img' },
  { pause: 800 },
  { tapCentre: '.mob-sky-canvas' },
  { wait: '.mob-map-sheet' },
  { pause: 600 },
  { click: `.mob-map-sheet [aria-label="Ordre d'affichage"]` },
  { wait: '.mob-entry' },
  { pause: 400 },
];
// The plus of the regions page opens the map to draw a region.
const REGION_DRAW_OPEN = [
  { click: '.mob-fab' },
  { wait: '.mob-map-mode .mob-panel' },
  { pause: 800 },
];
// The setup picker opened over "Contours de champ".
const PICK_SETUP = 'ion-modal.show-modal:has(.mob-sheet-title:text-is("Choisir un setup"))';

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
  { name: 'targets-regions', path: '/targets/regions', ready: '.mob-row--region' },
  // The plus of the regions page: the map in local sky with the panel of the region under it.
  {
    name: 'region-draw',
    path: '/targets/regions',
    ready: '.mob-row--region',
    open: REGION_DRAW_OPEN,
  },
  {
    name: 'region-draw-drawn',
    path: '/targets/regions',
    ready: '.mob-row--region',
    open: [
      ...REGION_DRAW_OPEN,
      {
        drag: '.mob-sky-canvas',
        path: [
          [0.35, 0.35],
          [0.65, 0.35],
          [0.65, 0.6],
          [0.35, 0.6],
          [0.35, 0.36],
        ],
      },
      { fill: '.mob-map-mode .mob-panel input', text: 'Vue depuis le jardin' },
      { pause: 300 },
    ],
  },
  // The pin of a region: the map in local sky with the region drawn, under a title bar of its name.
  {
    name: 'region-view',
    path: '/targets/regions',
    ready: '.mob-row--region',
    open: [
      { click: '[aria-label^="Voir la région"]' },
      { wait: '.mob-map-mode--bare' },
      { pause: 800 },
    ],
  },
  { name: 'sky', path: '/tabs/sky', ready: '.mob-map-top' },
  {
    name: 'sky-layers',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The calendar button puts the map in the date mode: the time bar and the toggles appear.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(3)' },
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
  // The display order page, opened from the photo's sheet (the seed's photos all lie over the pole: they overlap).
  {
    name: 'sky-draw-order',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: DRAW_ORDER_OPEN,
  },
  {
    name: 'sky-draw-order-search',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      ...DRAW_ORDER_OPEN,
      { fill: '.mob-form-row input[type="search"]', text: 'Cygnus' },
      { pause: 300 },
    ],
  },
  {
    name: 'sky-frames',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The telescope button opens "Contours de champ".
    open: [{ click: '.mob-map-top ion-button:nth-of-type(2)' }, { wait: '.mob-check-lead-row' }],
    scope: OPEN_SHEET,
  },
  {
    name: 'sky-frame',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // A frame tapped in "Contours de champ" is selected: its sheet opens over the map.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: '.mob-check-lead-text' },
      { wait: '.mob-map-sheet .mob-slider-row' },
      { pause: 600 },
    ],
  },
  {
    name: 'sky-mosaic',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The free mosaic tapped in "Contours de champ": its sheet with Lignes / Colonnes.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: '.mob-check-lead-row:has-text("Mosaïque") .mob-check-lead-text' },
      { wait: '.mob-map-sheet .mob-stepper-row' },
      { pause: 600 },
    ],
  },
  {
    name: 'sky-smart-frame',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The enlarged Seestar frame tapped in "Contours de champ": Largeur / Hauteur first in its sheet.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: '.mob-check-lead-row:has-text("Seestar") .mob-check-lead-text' },
      { wait: '.mob-map-sheet .mob-slider-row' },
      { pause: 600 },
    ],
  },
  {
    name: 'sky-mosaic-new',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // "Ajouter une mosaïque" with the free frames: a setup, then the mosaic form with an object picked.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: 'ion-modal.show-modal .mob-row:has-text("Ajouter une mosaïque")' },
      { wait: `${PICK_SETUP} .mob-row:has-text("Newton 200")` },
      { click: `${PICK_SETUP} .mob-row:has-text("Newton 200")` },
      { wait: 'ion-modal.show-modal .mob-stepper-row' },
      { fill: 'ion-modal.show-modal input[type="search"]', text: 'M31' },
      { wait: 'ion-modal.show-modal .mob-row:has-text("M31 —")' },
      { click: 'ion-modal.show-modal .mob-row:has-text("M31 —")' },
      { wait: 'ion-modal.show-modal .mob-chip' },
      { pause: 600 },
    ],
    scope: '.mob-sheet:has(> .mob-sheet-body > .mob-stepper-row)',
  },
  {
    name: 'sky-mosaic-new-results',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The mosaic form while objects are listed: they take the place of the other fields and of the buttons.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: 'ion-modal.show-modal .mob-row:has-text("Ajouter une mosaïque")' },
      { wait: `${PICK_SETUP} .mob-row:has-text("Newton 200")` },
      { click: `${PICK_SETUP} .mob-row:has-text("Newton 200")` },
      { wait: 'ion-modal.show-modal .mob-stepper-row' },
      { fill: 'ion-modal.show-modal input[type="search"]', text: 'M3' },
      { wait: 'ion-modal.show-modal .mob-row:has-text("M31 —")' },
      { pause: 600 },
    ],
    scope: '.mob-sheet:has(> .mob-sheet-body > .mob-stepper-row)',
  },
  {
    name: 'sky-frames-plan',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // "Contours de champ" of a plan: its "Setup" field under "Cadres".
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: 'ion-modal.show-modal .mob-form-row--field ion-button' },
      { wait: 'ion-modal.show-modal ion-radio' },
      { click: 'ion-modal.show-modal ion-radio:has-text("Nuit d’été")' },
      { wait: 'ion-modal.show-modal .mob-form-row--field:has-text("Setup")' },
      { pause: 800 },
    ],
    scope: OPEN_SHEET,
  },
  {
    name: 'sky-setup-switch',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    // The summer plan's setup changed: its mosaic asks Appliquer / Supprimer.
    open: [
      { click: '.mob-map-top ion-button:nth-of-type(2)' },
      { wait: '.mob-check-lead-text' },
      { click: 'ion-modal.show-modal .mob-form-row--field ion-button' },
      { wait: 'ion-modal.show-modal ion-radio' },
      { click: 'ion-modal.show-modal ion-radio:has-text("Nuit d’été")' },
      { pause: 800 },
      { click: 'ion-modal.show-modal .mob-form-row--field:has-text("Setup") ion-button' },
      { wait: 'ion-modal.show-modal ion-radio:has-text("C6")' },
      { click: 'ion-modal.show-modal ion-radio:has-text("C6")' },
      { wait: 'ion-modal.show-modal .mob-seg' },
      { pause: 600 },
    ],
    scope: '.mob-sheet:has(> .mob-sheet-body > .mob-panel .mob-seg)',
  },
  {
    name: 'sky-frame-picker',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      { click: '.mob-map-top ion-input' },
      { wait: '.mob-search-wrap' },
      { fill: '.mob-search-wrap input', text: 'andro' },
      { wait: '.mob-row--roomy' },
      { click: '.mob-row--roomy' },
      { wait: '.mob-map-sheet' },
      { click: '.mob-map-sheet .mob-icon-row ion-button:nth-of-type(1)' },
      { wait: 'ion-modal .mob-section-header' },
      { pause: 600 },
    ],
    scope: OPEN_SHEET,
  },
  { name: 'sky-search', path: '/sky/search', ready: '.mob-search-wrap' },
  {
    name: 'sky-search-results',
    path: '/sky/search',
    ready: '.mob-search-wrap',
    open: [{ fill: '.mob-search-wrap input', text: 'andro' }, { wait: '.mob-row--roomy' }],
  },
  // The Photos tab of the search: the seed's photos are named after constellations, and all hold the same objects.
  {
    name: 'sky-search-photos',
    path: '/sky/search',
    ready: '.mob-search-wrap',
    open: [
      { click: '.mob-search-tabs .mob-seg-btn:nth-child(2)' },
      { fill: '.mob-search-wrap input', text: 'Cygnus' },
      { wait: '.mob-row-thumb' },
      { pause: 400 },
    ],
  },
  {
    name: 'sky-search-photos-none',
    path: '/sky/search',
    ready: '.mob-search-wrap',
    open: [
      { click: '.mob-search-tabs .mob-seg-btn:nth-child(2)' },
      { fill: '.mob-search-wrap input', text: 'zzz' },
      { wait: '.mob-empty-text' },
    ],
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
    name: 'gallery-sort',
    path: '/tabs/gallery',
    ready: '.mob-photo',
    open: [
      { click: '.mob-topbar ion-button.mob-icon-btn:last-of-type' },
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
  // The objects drawn over the seed's photo: its sheet with the objects toggle on and the catalogues field under the
  // facts (board "Photo, objets affichés"). Then each identification page (SkyBoT, TNS and the MPC answer from
  // `fixtures`).
  {
    name: 'photo-objects',
    path: (ids) => `/gallery/photo/${ids.photo}`,
    ready: '.mob-photo-view',
    open: [
      { click: '.mob-topbar--overlay ion-button.mob-icon-btn:last-of-type' },
      { wait: OPEN_SHEET },
      { pause: 600 },
      { click: `${OPEN_SHEET} .mob-icon-row ion-button:nth-of-type(3)` },
      { wait: `${OPEN_SHEET} .mob-form-row--field` },
      { pause: 600 },
    ],
    scope: OPEN_SHEET,
  },
  {
    name: 'identify-asteroid',
    path: (ids) => `/gallery/photo/${ids.photo}/identify/asteroid`,
    ready: '.mob-when-row',
    open: [{ tapAt: '.mob-photo-area', x: 0.4, y: 0.45 }, { wait: '.mob-marker' }],
  },
  {
    name: 'identify-asteroid-results',
    path: (ids) => `/gallery/photo/${ids.photo}/identify/asteroid`,
    ready: '.mob-when-row',
    open: [
      { tapAt: '.mob-photo-area', x: 0.4, y: 0.45 },
      { tapAt: '.mob-photo-area', x: 0.6, y: 0.55 },
      { click: '.mob-when-row--radius ion-button' },
      { wait: '.mob-results-list' },
    ],
  },
  {
    name: 'identify-supernova',
    path: (ids) => `/gallery/photo/${ids.photo}/identify/supernova`,
    ready: '.mob-check-row',
  },
  {
    name: 'identify-comet',
    path: (ids) => `/gallery/photo/${ids.cometPhoto}/identify/comet`,
    ready: '.mob-check-lead-row',
  },
  {
    name: 'poi-add',
    path: (ids) => `/gallery/photo/${ids.photo}/poi`,
    ready: '.mob-identify-type',
    open: [{ tapAt: '.mob-photo-area', x: 0.5, y: 0.5 }, { wait: '.mob-marker--tint' }],
  },
  {
    name: 'poi-add-type',
    path: (ids) => `/gallery/photo/${ids.photo}/poi`,
    ready: '.mob-identify-type',
    open: [
      { click: '.mob-identify-type ion-button.mob-btn--field' },
      { wait: OPEN_SHEET },
      { pause: 600 },
    ],
    scope: OPEN_SHEET,
  },
  { name: 'poi-types', path: '/gallery/poi-types', ready: '.mob-type-row' },
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
  { name: 'about', path: '/settings/about', ready: '.mob-bullets li' },
  { name: 'privacy', path: '/settings/privacy', ready: '.mob-text-title' },
];
