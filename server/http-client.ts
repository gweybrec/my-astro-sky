import type { HttpClient, HttpRequest } from '@myastrosky/core/ports/http-client';

function toBody(body: HttpRequest['body']): string | FormData | undefined {
  if (body === undefined || typeof body === 'string') return body;
  const form = new FormData();
  for (const part of body.form) {
    if ('bytes' in part) {
      form.append(
        part.name,
        new Blob([part.bytes as BlobPart], { type: part.type }),
        part.fileName,
      );
    } else {
      form.append(part.name, part.value);
    }
  }
  return form;
}

/** The HTTP client of the server: Node's `fetch`, with the request's timeout as an abort. */
export function createFetchHttpClient(): HttpClient {
  return async (request) => {
    const controller = new AbortController();
    const timer =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const res = await globalThis.fetch(request.url, {
        method: request.method,
        ...(request.headers ? { headers: { ...request.headers } } : {}),
        body: toBody(request.body),
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      // The body is read before the timer is cleared, as the callers did with `fetch`.
      const buffer = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        headers,
        text: async () => new TextDecoder().decode(buffer),
        bytes: async () => buffer,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
