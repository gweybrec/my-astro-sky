export const MAX_SANITIZE_VALUE_LENGTH = 4096;
export const MAX_SANITIZE_DEPTH = 5;

const REDACT_KEY_RE =
  /(password|passwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|session|jwt)/i;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// Shared by the desktop's log file (electron/error-logger.ts) and the phone's (apps/mobile/src/error-log.ts).

const ASTROMETRY_KEY_JSON_RE = /("apikey"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)(")/gi;
const ASTROMETRY_KEY_JSON_URLENC_RE = /(%22apikey%22%3A%22)(.*?)(%22)/gi;
const API_KEY_FORM_RE = /(apikey=)([^&\s]+)/gi;
const ASTROMETRY_ENV_ASSIGN_RE = /(ASTROMETRY_API_KEY\s*[=:]\s*)([^\s,;]+)/gi;

function redactPattern(input: string, re: RegExp, valueGroup: number): string {
  return input.replace(re, (...args: string[]) => {
    const match = args[0];
    const groups = args.slice(1, -2);
    if (groups.length < valueGroup) return match;
    groups[valueGroup - 1] = '[redacted]';
    let rebuilt = '';
    let cursor = 0;
    const full = match;
    for (let i = 0; i < groups.length; i += 1) {
      const g = args[i + 1];
      const idx = full.indexOf(g, cursor);
      if (idx === -1) return match;
      rebuilt += full.slice(cursor, idx);
      rebuilt += groups[i];
      cursor = idx + g.length;
    }
    rebuilt += full.slice(cursor);
    return rebuilt;
  });
}

/**
 * Replaces API keys in a text written to a log: `knownSecrets` (the configured astrometry.net key)
 * wherever they appear, and any value that looks like one (`"apikey":"…"`, `apikey=…`).
 */
export function redactSecrets(input: string, knownSecrets: readonly string[] = []): string {
  let out = input;

  for (const secret of knownSecrets) {
    const key = secret.trim();
    if (key) out = out.split(key).join('[redacted]');
  }

  out = redactPattern(out, ASTROMETRY_KEY_JSON_RE, 2);
  out = redactPattern(out, ASTROMETRY_KEY_JSON_URLENC_RE, 2);
  out = redactPattern(out, API_KEY_FORM_RE, 2);
  out = redactPattern(out, ASTROMETRY_ENV_ASSIGN_RE, 2);

  return out;
}

// An absolute path of the user's machine or phone (a drive, a network share, a home or storage
// folder, a file:// or content:// address). A placeholder the path anonymiser already put
// (`<home>`, `<app>`) is left: what follows it is the app's own code.
const ABSOLUTE_PATH_RE = new RegExp(
  [
    String.raw`\b[A-Za-z]:[\\/](?!<)[^\s'"<>|*?]*`,
    String.raw`\\\\[^\s'"<>|*?]+`,
    String.raw`\b(?:file|content):\/\/\/?(?!<)[^\s'"<>)]*`,
    String.raw`(?<![\w.:<>])\/(?:home|Users|data|storage|sdcard|mnt|media|Volumes|var|tmp|private)\/[^\s'"<>):]*`,
  ].join('|'),
  'g',
);
// A file the user picked, made or shared: a photo, a solution, a backup, a shared sky, an export.
// Code files (.js, .ts, .vue) are not in the list, so a stack trace keeps its locations.
const USER_FILE_EXT =
  'fits?|fts|jpe?g|png|tiff?|xisf|cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|heic|heif|webp|gif|bmp|myastrosky|zip|csv|txt|wcs|new|axy|hzn|pdf|svg|xml';
// A quoted name, spaces included, as Node and most libraries write one ('M31 final.fits').
const QUOTED_USER_FILE_RE = new RegExp(
  String.raw`(['"])[^'"\n]*\.(?:` + USER_FILE_EXT + String.raw`)\1`,
  'gi',
);
const USER_FILE_RE = new RegExp(
  String.raw`[^\s/\\'"(),:;<>[\]{}]+\.(?:` + USER_FILE_EXT + String.raw`)\b`,
  'gi',
);

// The address of an outside server keeps only its host: its path and query can hold what was asked
// (a field of the sky and a date, a map tile near the user). The app's own addresses (localhost,
// the phone's https://localhost) stay whole: they are the code locations of a stack trace.
const EXTERNAL_URL_RE =
  /\b(https?):\/\/(?!localhost[:/]|127\.0\.0\.1[:/])([^\s/'"<>)]+)[^\s'"<>)]*/g;

/**
 * Removes from a text written to a log what could be the user's data: absolute paths become
 * `[path]` and the names of photo, data and backup files become `[file]`. With `redactSecrets`, the
 * log holds only what the app itself says, never the user's file names, folders or keys.
 */
export function removeUserData(input: string): string {
  return (
    input
      // A JSON parse error quotes the start of what it read, which can be a file of the user's.
      .replace(/"(?:[^"\\]|\\.)*"(?= is not valid JSON)/g, '"…"')
      .replace(EXTERNAL_URL_RE, '$1://$2/…')
      .replace(QUOTED_USER_FILE_RE, '$1[file]$1')
      .replace(ABSOLUTE_PATH_RE, '[path]')
      .replace(USER_FILE_RE, '[file]')
  );
}

/**
 * Recursively sanitizes an unknown value for safe inclusion in a log record.
 * Strings are redacted for secrets and then passed through the anonymize function.
 * Object keys matching sensitive patterns are replaced with '[redacted]'.
 * Depth and value length are bounded to prevent runaway serialization.
 */
export function sanitizeContext(
  value: unknown,
  anonymize: (s: string) => string = (s) => s,
  depth = 0,
  knownSecrets: readonly string[] = [],
): Json {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const cleaned = removeUserData(anonymize(redactSecrets(value, knownSecrets)));
    return cleaned.length > MAX_SANITIZE_VALUE_LENGTH
      ? `${cleaned.slice(0, MAX_SANITIZE_VALUE_LENGTH)}…[truncated]`
      : cleaned;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: removeUserData(anonymize(redactSecrets(value.message, knownSecrets))),
      stack: value.stack
        ? (sanitizeContext(value.stack, anonymize, depth + 1, knownSecrets) as string)
        : null,
    };
  }

  if (depth >= MAX_SANITIZE_DEPTH) return '[max-depth-reached]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContext(item, anonymize, depth + 1, knownSecrets));
  }

  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_RE.test(key)
        ? '[redacted]'
        : sanitizeContext(raw, anonymize, depth + 1, knownSecrets);
    }
    return out;
  }

  return String(value);
}
