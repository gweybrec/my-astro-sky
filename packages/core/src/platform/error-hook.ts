import { newErrorTicket, type ErrorTicket } from './error-report';

export type ErrorReporter = (
  context: string,
  error: unknown,
  details: Record<string, unknown> | undefined,
  ticket: ErrorTicket,
) => void;

const defaultReporter: ErrorReporter = (context, error, _details, ticket) => {
  console.error(`${context} [${ticket.code} ${ticket.ref}]`, error);
};

let reporter: ErrorReporter = defaultReporter;

/** Called once at start-up by each platform; the default writes to the console. */
export function configureErrorReporter(fn: ErrorReporter): void {
  reporter = fn;
}

/**
 * Records `error` through the platform's reporter (the desktop's log file, the phone's log) and
 * returns its ticket: the code and reference to show the user. Pass `ticket` to record an error
 * already shown with one. Reporting never throws.
 */
export function reportError(
  context: string,
  error: unknown,
  details?: Record<string, unknown>,
  ticket: ErrorTicket = newErrorTicket(error),
): ErrorTicket {
  try {
    reporter(context, error, details, ticket);
  } catch {
    // A broken reporter must never turn one error into two.
  }
  return ticket;
}
