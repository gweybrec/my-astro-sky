import {
  errorCauses,
  newErrorTicket,
  type ErrorTicket,
} from '@myastrosky/core/platform/error-report';
import {
  redactSecrets,
  removeUserData,
  sanitizeContext,
} from '@myastrosky/core/platform/log-sanitize';

type LogFn = (
  category: string,
  error: unknown,
  context: Record<string, unknown> | undefined,
  ticket: ErrorTicket,
) => void;

let _logFn: LogFn | null = null;

/** The desktop app installs its log file here; a Docker or Node.js server writes to the console. */
export function installLogger(fn: LogFn): void {
  _logFn = fn;
}

/**
 * Records a server error and returns its ticket (code and reference), which the response carries
 * so the user can quote it. Logging never throws.
 */
export function logServerError(
  category: string,
  error: unknown,
  context?: Record<string, unknown>,
  ticket: ErrorTicket = newErrorTicket(error),
): ErrorTicket {
  const causes = errorCauses(error);
  if (causes.length) context = { ...context, causes };
  try {
    if (_logFn) {
      _logFn(category, error, context, ticket);
    } else {
      // A Docker or Node.js server's log is its console: cleaned as the log files are.
      const secrets = process.env.ASTROMETRY_API_KEY ? [process.env.ASTROMETRY_API_KEY] : [];
      const text =
        error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
      console.error(
        `${new Date().toISOString()} [${category}] ${ticket.code} ${ticket.ref}`,
        removeUserData(redactSecrets(text, secrets)),
        ...(context ? [JSON.stringify(sanitizeContext(context, (s) => s, 0, secrets))] : []),
      );
    }
  } catch {
    // A failing log must never turn one error into two.
  }
  return ticket;
}
