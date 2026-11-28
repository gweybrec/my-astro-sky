// Downloads for the catalogue scripts, with an error that says what went wrong. Node's
// fetch() only says "fetch failed"; the reason (refused, timed out, DNS, certificate…) is
// in error.cause, sometimes an AggregateError holding one error per address tried.

import { gunzipSync } from 'zlib';

const TIMEOUT_MS = 60_000;

/**
 * Where the CDS catalogue files (cdsarc's /ftp/<catalogue>/<file>) can be downloaded, CDS
 * first. NAOJ and China-VO serve them over plain HTTP only, so they come last.
 */
export const CDS_FILE_MIRRORS = [
  'https://cdsarc.cds.unistra.fr/ftp/',
  'https://vizier.cfa.harvard.edu/ftp/cats/',
  'http://vizier.nao.ac.jp/ftp/cats/',
  'http://vizier.china-vo.org/ftp/cats/',
];

/** SIMBAD's TAP query endpoint, CDS first, then its mirrors (CfA Harvard, IDIA South Africa). */
export const SIMBAD_TAP_MIRRORS = [
  'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
  'https://simbad.cfa.harvard.edu/simbad/sim-tap/sync',
  'https://simbad.idia.ac.za/simbad/sim-tap/sync',
];

/** Plain reasons for the network error codes Node reports. */
const REASONS = {
  ECONNREFUSED: 'the server refused the connection (server down, or the port is blocked)',
  ECONNRESET: 'the connection was cut (server or network dropped it)',
  ETIMEDOUT: 'the connection timed out (server down, or a firewall or proxy drops it)',
  UND_ERR_CONNECT_TIMEOUT:
    'the connection timed out (server down, or a firewall or proxy drops it)',
  UND_ERR_HEADERS_TIMEOUT: 'the server accepted the connection but never answered',
  UND_ERR_SOCKET: 'the connection was closed during the download',
  ENOTFOUND: 'the host name was not found (no internet, or DNS problem)',
  EAI_AGAIN: 'the host name could not be looked up (no internet, or DNS problem)',
  ENETUNREACH: 'the network is unreachable (no internet connection)',
  EHOSTUNREACH: 'the host is unreachable',
  CERT_HAS_EXPIRED: "the server's certificate has expired",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'the certificate could not be verified (a proxy or antivirus intercepting HTTPS?)',
  SELF_SIGNED_CERT_IN_CHAIN:
    'the certificate could not be verified (a proxy or antivirus intercepting HTTPS?)',
};

/** Every error in the chain: the error, its causes, and the errors of an AggregateError. */
function errorChain(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return [];
  seen.add(error);
  const nested = Array.isArray(error.errors) ? error.errors : [];
  return [error, ...nested.flatMap((e) => errorChain(e, seen)), ...errorChain(error.cause, seen)];
}

/** One line telling why a download failed, e.g. "the server refused the connection (…) [ECONNREFUSED 130.79.129.14:443]". */
export function describeFetchError(error) {
  const chain = errorChain(error);
  if (chain.some((e) => e.name === 'TimeoutError'))
    return `no answer within ${TIMEOUT_MS / 1000} s (server down or very slow)`;
  const codes = [...new Set(chain.map((e) => e.code).filter(Boolean))];
  const details = [
    ...new Set(
      chain
        .map((e) => e.message)
        .filter((m) => m && m !== 'fetch failed' && !(m.startsWith('connect ') && codes.length)),
    ),
  ];
  // "connect ECONNREFUSED 130.79.129.14:443": keep the address, it tells which server refused
  const addresses = [
    ...new Set(
      chain
        .map((e) => (e.address ? `${e.address}${e.port ? `:${e.port}` : ''}` : null))
        .filter(Boolean),
    ),
  ];
  const reason = codes.map((c) => REASONS[c]).find(Boolean);
  const raw = [...codes, ...addresses].join(' ');
  if (reason) return raw ? `${reason} [${raw}]` : reason;
  if (raw || details.length) return [raw, ...details].filter(Boolean).join(': ');
  return String(error?.message ?? error);
}

/**
 * The text at `url`; throws an error naming `what`, the URL and the reason.
 * `{ gzip: true }` unpacks a gzipped file (CDS serves some catalogues only as .gz).
 */
export async function fetchText(url, what, { gzip = false } = {}) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Could not download ${what} from ${url}: ${describeFetchError(error)}`, {
      cause: error,
    });
  }
  if (!res.ok)
    throw new Error(
      `Could not download ${what} from ${url}: the server answered HTTP ${res.status} ${res.statusText}`.trim(),
    );
  if (!gzip) return await res.text();
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('latin1');
}

/** Per mirror list, the one that answered last: later calls start there (a down server costs one time-out, not one per call). */
const workingMirror = new WeakMap();

/**
 * The text at `base + suffix`, trying each base of `mirrors` in turn until one answers.
 * Each failure is logged; when every mirror fails, the error lists all of them.
 */
export async function fetchFromMirrors(mirrors, suffix, what, options) {
  const start = workingMirror.get(mirrors) ?? 0;
  const order = [...mirrors.slice(start), ...mirrors.slice(0, start)];
  const failures = [];
  for (const base of order) {
    try {
      const text = await fetchText(base + suffix, what, options);
      if (base !== mirrors[0] && workingMirror.get(mirrors) !== mirrors.indexOf(base))
        console.warn(`  (${what}: using the mirror ${new URL(base).host})`);
      workingMirror.set(mirrors, mirrors.indexOf(base));
      return text;
    } catch (error) {
      failures.push(error.message);
      if (base !== order.at(-1)) console.warn(`  ${error.message} — trying the next mirror`);
    }
  }
  throw new Error(`Could not download ${what} from any mirror:\n  ${failures.join('\n  ')}`);
}

/** A CDS catalogue file, e.g. cdsFile('VII/9/catalog.dat', 'the LBN catalogue'), from CDS or a mirror. */
export function cdsFile(path, what, options) {
  return fetchFromMirrors(CDS_FILE_MIRRORS, path, what, options);
}
