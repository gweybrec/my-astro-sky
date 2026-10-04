export type DomainErrorKind = 'invalid' | 'notFound' | 'conflict' | 'rateLimited' | 'upstream';

/** A rule of the domain was not met. Routes and the phone UI turn it into a response or a message. */
export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  /** Stable machine code, when the client translates the message. */
  readonly code?: string;
  /** The exact response body to send, when it is not `{ error: message }`. */
  readonly body?: Readonly<Record<string, unknown>>;

  constructor(
    kind: DomainErrorKind,
    message: string,
    options?: { code?: string; body?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.code = options?.code;
    this.body = options?.body;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
