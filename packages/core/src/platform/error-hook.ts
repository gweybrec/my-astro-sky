export type ErrorReporter = (
  context: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

const defaultReporter: ErrorReporter = (context, error) => {
  console.error(context, error);
};

let reporter: ErrorReporter = defaultReporter;

/** Called once at start-up by each platform; the default writes to the console. */
export function configureErrorReporter(fn: ErrorReporter): void {
  reporter = fn;
}

export function reportError(
  context: string,
  error: unknown,
  details?: Record<string, unknown>,
): void {
  if (details === undefined) reporter(context, error);
  else reporter(context, error, details);
}
