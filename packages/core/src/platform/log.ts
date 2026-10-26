/**
 * Debug and info messages for developers. Off until a platform installs a sink, which each one does only in
 * development builds, so a release build prints nothing but its notices (`logNotice`). Errors go through `reportError` (error-hook), not here.
 * This is the only module allowed to call `console.log` / `console.info` (ESLint `no-console`).
 */
export type LogLevel = 'debug' | 'info';

export type LogSink = (
  level: LogLevel,
  context: string,
  message: string,
  details?: Record<string, unknown>,
) => void;

/** Prints to the console: `[context] message`, then the details if any. */
export const consoleLogSink: LogSink = (level, context, message, details) => {
  const print = level === 'info' ? console.info : console.log;
  if (details === undefined) print(`[${context}] ${message}`);
  else print(`[${context}] ${message}`, details);
};

let sink: LogSink | null = null;

/** Called at start-up by each platform: a sink in development builds, `null` (nothing printed) in release builds. */
export function configureLogSink(fn: LogSink | null): void {
  sink = fn;
}

/** True when messages are printed, for a caller that would otherwise build costly details for nothing. */
export function isLogEnabled(): boolean {
  return sink !== null;
}

export function logDebug(
  context: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!sink) return;
  if (details === undefined) sink('debug', context, message);
  else sink('debug', context, message, details);
}

export function logInfo(context: string, message: string, details?: Record<string, unknown>): void {
  if (!sink) return;
  if (details === undefined) sink('info', context, message);
  else sink('info', context, message, details);
}

/**
 * A message printed in every build, release included: only for the few lines someone running a release expects,
 * such as the server's "started on port" line. Goes to the sink when one is installed, else straight to the console.
 */
export function logNotice(context: string, message: string): void {
  if (sink) sink('info', context, message);
  else consoleLogSink('info', context, message);
}
