import { redactSecrets } from './secret-redaction.js';

export const MAX_SANITIZE_VALUE_LENGTH = 4096;
export const MAX_SANITIZE_DEPTH = 5;

const REDACT_KEY_RE = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|session|jwt)/i;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

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
): Json {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const cleaned = anonymize(redactSecrets(value));
    return cleaned.length > MAX_SANITIZE_VALUE_LENGTH
      ? `${cleaned.slice(0, MAX_SANITIZE_VALUE_LENGTH)}…[truncated]`
      : cleaned;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: anonymize(redactSecrets(value.message)),
      stack: value.stack ? (sanitizeContext(value.stack, anonymize, depth + 1) as string) : null,
    };
  }

  if (depth >= MAX_SANITIZE_DEPTH) return '[max-depth-reached]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContext(item, anonymize, depth + 1));
  }

  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_RE.test(key)
        ? '[redacted]'
        : sanitizeContext(raw, anonymize, depth + 1);
    }
    return out;
  }

  return String(value);
}
