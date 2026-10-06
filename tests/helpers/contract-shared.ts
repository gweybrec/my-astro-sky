/**
 * What both contract runs (HTTP and local) share: the files the cases upload, the recorded answers of the
 * sites a backend reaches out to (`globalThis.fetch` is the interception point; calls to the test server
 * itself pass through), and the way a run hands them to the contract.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { vi } from 'vitest';
import type { FileSource } from '@myastrosky/core/backend';
import type {
  ContractFixtures,
  ContractNetworkAnswer,
} from '@myastrosky/core/testing/backend-contract';
import { buildFits } from '../fixtures/fits-builders';

const FIXTURES = path.join(__dirname, '../fixtures');
const read = (file: string) => fs.readFileSync(path.join(FIXTURES, file), 'utf8');

/** A file as the contract wants it: bytes in memory, no browser `File`. */
export function fileSource(name: string, bytes: Uint8Array): FileSource {
  return { name, size: bytes.length, read: async () => bytes };
}

// A 40x30 mono FITS whose solution (0.1 degree per pixel) covers a field of the real star catalogue.
const FITS_CARDS = [
  'CRPIX1  = 20.5',
  'CRPIX2  = 15.5',
  'CRVAL1  = 330.21217',
  'CRVAL2  = 73.08178',
  'CD1_1   = -0.1',
  'CD1_2   = 0',
  'CD2_1   = 0',
  'CD2_2   = 0.1',
  "DATE-OBS= '2025-09-04T21:30:00'",
  'EXPTIME = 300',
  'STACKCNT= 12',
  "FILTER  = 'Ha'",
];

/** The answers the fake network gives, by site; `undefined` (reset) means the recorded file. */
type Answers = Partial<Record<'skybot' | 'tns' | 'comets' | 'version', ContractNetworkAnswer>>;

const realFetch = globalThis.fetch;

const recorded = {
  skybot: read('skybot/ngc4438-conesearch.json'),
  tns: read('tns/ngc7331-search.csv'),
  comets: read('comets/CometEls-sample.txt'),
  version: JSON.stringify({
    tag_name: 'v9.9.9',
    html_url: 'https://example.invalid/release/v9.9.9',
    published_at: '2026-01-02T03:04:05Z',
  }),
};
let answers: Answers = {};
let running = 0;

const siteOf = (url: string): keyof Answers | undefined => {
  if (url.includes('skybot')) return 'skybot';
  if (url.includes('wis-tns.org')) return 'tns';
  if (url.includes('CometEls')) return 'comets';
  if (url.includes('api.github.com')) return 'version';
  return undefined;
};

// Anything that is not the test server is "the internet".
const fakeInternet = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input as string, init);
  const site = siteOf(url);
  if (!site) throw new Error(`the contract tests may not reach ${url}`);
  const answer = answers[site] ?? { status: 200, body: recorded[site] };
  return new Response(answer.body, { status: answer.status, headers: answer.headers });
};

/** Puts the fake network in place of `fetch` until every run that asked for it has released it. */
export function installFakeInternet(): void {
  if (running++ === 0) vi.stubGlobal('fetch', fakeInternet);
}

export function releaseFakeInternet(): void {
  if (--running === 0) vi.stubGlobal('fetch', realFetch);
}

/** Back to the recorded answers. */
export function resetFakeInternet(): void {
  answers = {};
}

/** The fixtures of the contract; `lastExport` is the run's own (what its save hook was given). */
export async function buildFixtures(
  lastExport: ContractFixtures['lastExport'],
): Promise<ContractFixtures> {
  const jpeg = new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#203060' } })
      .jpeg()
      .toBuffer(),
  );
  const fits = new Uint8Array(
    buildFits({
      bitpix: -32,
      naxis1: 40,
      naxis2: 30,
      roworder: 'TOP-DOWN',
      pixels: Array.from({ length: 40 * 30 }, (_, i) => (i % 7) / 7),
      extraCards: FITS_CARDS,
    }),
  );
  return {
    jpeg: () => fileSource('contract.jpg', jpeg),
    fits: () => fileSource('contract.fits', fits),
    text: () => fileSource('contract.txt', new TextEncoder().encode('not a picture')),
    lastExport,
    network: {
      answer(site, answer) {
        answers = { ...answers, [site]: answer };
      },
    },
  };
}
