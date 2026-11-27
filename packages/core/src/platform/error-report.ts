import { ERROR_CODES, type ErrorCode } from '../domain/error-codes';
import { DomainError, type DomainErrorKind } from '../domain/errors';
import { t } from '../i18n';

/**
 * What ties an error on screen to its line in the log: the error's code (`INTERNAL_ERROR` when it
 * has none) and a short random reference the user can quote in a bug report.
 */
export interface ErrorTicket {
  code: ErrorCode;
  ref: string;
}

/** An error whose message is already written for the user, in their language. */
export interface UserFacingError extends Error {
  readonly userFacing: true;
  readonly code?: ErrorCode;
  readonly kind?: DomainErrorKind;
  /** The reference a server already logged this error under. */
  readonly ref?: string;
}

const KNOWN_CODES = new Set<string>(ERROR_CODES);
// Crockford base 32 without I, L, O and U: nothing a user can misread when retyping it.
const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newErrorRef(): string {
  let ref = '';
  for (let i = 0; i < 4; i++) ref += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return ref;
}

function ownCode(err: unknown): ErrorCode | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as ErrorCode) : undefined;
}

export function errorCodeOf(err: unknown): ErrorCode {
  return ownCode(err) ?? 'INTERNAL_ERROR';
}

/** The error's ticket: the reference a server gave it, else a new one. */
export function newErrorTicket(err: unknown): ErrorTicket {
  const ref = (err as { ref?: unknown } | null)?.ref;
  return { code: errorCodeOf(err), ref: typeof ref === 'string' && ref ? ref : newErrorRef() };
}

/** Wraps a message already translated for the user, with the code and kind it came from, if any. */
export function userFacingError(
  message: string,
  options: { code?: ErrorCode; kind?: DomainErrorKind; ref?: string; cause?: unknown } = {},
): UserFacingError {
  const err = new Error(
    message,
    options.cause === undefined ? undefined : { cause: options.cause },
  );
  return Object.assign(err, {
    userFacing: true as const,
    code: options.code,
    kind: options.kind,
    ref: options.ref,
  });
}

export function isUserFacingError(err: unknown): err is UserFacingError {
  return err instanceof Error && (err as Partial<UserFacingError>).userFacing === true;
}

/**
 * The text of `code` in the user's language. A text with a `{placeholder}` needs details only
 * `detail` carries, so `detail` is used then; with no text at all, `detail`, else `fallbackKey`.
 */
export function translateErrorCode(
  code: string | undefined,
  detail: string | undefined,
  fallbackKey: string,
): string {
  if (code && KNOWN_CODES.has(code)) {
    const translated = t('serverErrors.' + code);
    const needsDetail = /\{\w+\}/.test(translated) && !!detail;
    if (!translated.startsWith('serverErrors.') && !needsDetail) return translated;
  }
  return detail || t(fallbackKey);
}

/**
 * What to show the user for `err`: its message when it was written for them, the translated text
 * of a domain error's code, and `fallbackKey` for anything else — never the raw English message of
 * an unexpected failure. A plain string is taken as already translated.
 */
export function userMessage(err: unknown, fallbackKey: string): string {
  if (typeof err === 'string') return err || t(fallbackKey);
  if (isUserFacingError(err)) return err.message || t(fallbackKey);
  if (err instanceof DomainError) return translateErrorCode(err.code, err.message, fallbackKey);
  const code = ownCode(err);
  if (code) return translateErrorCode(code, undefined, fallbackKey);
  return t(fallbackKey);
}

/**
 * Whether the user should be given a reference to quote: yes for a failure of the app, a server
 * or the network; no for a message about what the user entered (a validation, a conflict).
 */
export function needsErrorRef(err: unknown): boolean {
  if (typeof err === 'string') return false;
  const kind = (err as { kind?: DomainErrorKind } | null)?.kind;
  if (kind === 'invalid' || kind === 'conflict' || kind === 'notFound') return false;
  if (isUserFacingError(err)) return err.code !== undefined;
  return true;
}

/** The text a "copy" button puts on the clipboard, for a bug report. */
export function errorReportText(
  ticket: ErrorTicket,
  info: { version: string; platform: string; when?: Date },
): string {
  const when = (info.when ?? new Date()).toISOString();
  return `MyAstroSky ${info.version} (${info.platform}) · ${ticket.code} · ${ticket.ref} · ${when}`;
}

/**
 * What lies under an error, for its log line: each `cause` as "name: message", up to three levels (a translated
 * "the horizon failed" over the network failure that made it fail).
 */
export function errorCauses(err: unknown): string[] {
  const causes: string[] = [];
  let current = (err as { cause?: unknown } | null)?.cause;
  while (current !== undefined && current !== null && causes.length < 3) {
    causes.push(
      current instanceof Error
        ? `${current.name}: ${current.message}${(current as { code?: unknown }).code ? ` (${String((current as { code?: unknown }).code)})` : ''}`
        : String(current),
    );
    current = (current as { cause?: unknown }).cause;
  }
  return causes;
}
