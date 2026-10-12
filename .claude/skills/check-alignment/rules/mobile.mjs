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
//               (an open sheet); `variants: true` repeats the view in every language and at 130 % text.
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
      '.mob-row-lead, .mob-row-chevron, .mob-drag svg, .mob-btn-caret, .mob-icon-btn, .mob-check',
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
    bars: '.mob-topbar, .mob-sheet-footer, .mob-footer, .mob-input-row, .phone-field-unit-line, .mob-icon-row, .mob-map-top',
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
    within: '.mob-map-sheet',
    lefts: '.mob-fact:first-child, .mob-icon-row > :first-child',
    rights: '.mob-fact:last-child, .mob-icon-row > :last-child',
  },
  // On the map, the layers button and the column of toggles end on the same line, and the toggles are equally spaced
  // (the last one, set apart, is the only exception: it is measured against its own margin).
  {
    id: 'map-edges',
    type: 'edges',
    within: '.mob-map',
    rights: '.mob-map-top > ion-button, .mob-map-ribbon > ion-button',
  },
  { id: 'icon-row-gaps', type: 'equalGaps', bars: '.mob-icon-row' },
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
  { id: 'centred', type: 'centredBlock', boxes: '.mob-empty' },
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
    name: 'targets-filters',
    path: '/tabs/targets',
    ready: '.mob-row--roomy',
    open: [{ click: '.mob-topbar ion-button.mob-icon-btn' }, { wait: '.mob-sheet' }],
    ...SHEET,
  },
  { name: 'sky', path: '/tabs/sky', ready: '.mob-map-top' },
  {
    name: 'sky-layers',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [{ click: '.mob-map-top ion-button.mob-icon-btn' }, { wait: '.mob-map-ribbon' }],
  },
  {
    name: 'sky-display',
    path: '/tabs/sky',
    ready: '.mob-map-top',
    open: [
      { click: '.mob-map-top ion-button.mob-icon-btn' },
      { wait: '.mob-map-ribbon' },
      { click: '.mob-map-ribbon-more' },
      { wait: '.mob-sheet' },
    ],
    ...SHEET,
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
