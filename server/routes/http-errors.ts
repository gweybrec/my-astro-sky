import type { Response } from 'express';
import { isDomainError, type DomainErrorKind } from '@myastrosky/core/domain/errors';

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  invalid: 400,
  notFound: 404,
  conflict: 409,
  rateLimited: 429,
  upstream: 502,
};

/**
 * Sends the response for an error caught in a route handler: a `DomainError` becomes the status of
 * its kind and its `body` (or `{ error: message }`); anything else becomes `fallbackStatus`.
 */
export function sendError(res: Response, err: unknown, fallbackStatus = 500): void {
  if (isDomainError(err)) {
    res.status(STATUS_BY_KIND[err.kind]).json({
      ...(err.body ?? { error: err.message }),
      ...(err.body?.code ? {} : { code: err.code }),
    });
    return;
  }
  res.status(fallbackStatus).json({ error: (err as Error).message });
}
