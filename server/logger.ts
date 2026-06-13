type LogFn = (category: string, error: unknown, context?: Record<string, unknown>) => void;

let _logFn: LogFn | null = null;

export function installLogger(fn: LogFn): void {
  _logFn = fn;
}

export function logServerError(category: string, error: unknown, context?: Record<string, unknown>): void {
  if (_logFn) {
    _logFn(category, error, context);
  } else {
    console.error(`[${category}]`, error);
  }
}
