export interface RendererErrorPayload {
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
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

export function reportRendererError(payload: RendererErrorPayload): void {
  try {
    window.myAstroDiagnostics?.logError(payload).catch(() => {
      // Best-effort logging; never break UI flow.
    });
  } catch {
    // No-op outside Electron or if bridge is unavailable.
  }
}

export function reportUnknownRendererError(category: string, error: unknown, context?: Record<string, unknown>): void {
  const normalized = normalizeUnknownError(error);
  reportRendererError({
    category,
    message: normalized.message,
    stack: normalized.stack,
    context,
  });
}
