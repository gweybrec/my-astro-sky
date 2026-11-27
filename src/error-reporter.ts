import {
  errorCauses,
  newErrorTicket,
  type ErrorTicket,
} from '@myastrosky/core/platform/error-report';

export interface RendererErrorPayload {
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  /** The code and reference shown to the user, to find this record from a bug report. */
  code?: string;
  ref?: string;
}

function normalizeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Unknown error', stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: 'Unknown error', stack: undefined };
}

/**
 * Writes an error to the desktop app's log file. In a browser (development, Docker), where there
 * is no log file, it goes to the console instead, so nothing is lost silently.
 */
export function reportRendererError(payload: RendererErrorPayload): void {
  const bridge = window.myAstroDiagnostics;
  if (!bridge) {
    console.error(
      `[${payload.category}]${payload.code ? ` ${payload.code} ${payload.ref ?? ''}` : ''}`,
      payload.message,
      ...(payload.stack ? [payload.stack] : []),
      ...(payload.context ? [payload.context] : []),
    );
    return;
  }
  try {
    bridge.logError(payload).catch(() => {
      // Best-effort logging; never break UI flow.
    });
  } catch {
    // The bridge failed: never break the UI flow over a log line.
  }
}

export function reportUnknownRendererError(
  category: string,
  error: unknown,
  context?: Record<string, unknown>,
  ticket: ErrorTicket = newErrorTicket(error),
): ErrorTicket {
  const normalized = normalizeUnknownError(error);
  const causes = errorCauses(error);
  reportRendererError({
    category,
    message: normalized.message,
    stack: normalized.stack,
    context: causes.length ? { ...context, causes } : context,
    code: ticket.code,
    ref: ticket.ref,
  });
  return ticket;
}
