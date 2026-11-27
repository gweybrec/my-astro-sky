import type { Response } from 'express';
import { isDomainError, type DomainErrorKind } from '@myastrosky/core/domain/errors';
import { newErrorRef } from '@myastrosky/core/platform/error-report';
import { logServerError } from '../logger.js';

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  invalid: 400,
  notFound: 404,
  conflict: 409,
  rateLimited: 429,
  upstream: 502,
};

/** The route that failed, for the log: its pattern only, never the values in the path, the query or the body. */
function requestContext(res: Response): Record<string, unknown> {
  const req = res.req;
  return req?.route ? { method: req.method, route: req.baseUrl + String(req.route.path) } : {};
}

/**
 * Sends the response for an error caught in a route handler, and logs what is not the user's doing.
 * - A `DomainError` becomes the status of its kind and its `body` (or `{ error, code }`). One of
 *   kind `upstream` (an outside service or a local computation failed) is logged under `category`,
 *   and its reference goes in the response.
 * - Anything else is a bug: it is logged under `category` and becomes a 500 with the code
 *   `INTERNAL_ERROR` and its reference, never its raw message.
 */
export function sendError(res: Response, err: unknown, category = 'route_failed'): void {
  if (isDomainError(err)) {
    const ref =
      err.kind === 'upstream'
        ? logServerError(category, err.cause ?? err, requestContext(res), {
            code: err.code,
            ref: newErrorRef(),
          }).ref
        : undefined;
    res.status(STATUS_BY_KIND[err.kind]).json({
      ...(err.body ?? { error: err.message }),
      ...(err.body?.code ? {} : { code: err.code }),
      ...(ref ? { ref } : {}),
    });
    return;
  }
  const { code, ref } = logServerError(category, err, requestContext(res));
  res.status(500).json({ error: 'Internal error', code, ref });
}
