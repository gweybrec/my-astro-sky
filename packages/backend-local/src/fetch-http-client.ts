/**
 * The phone's `HttpClient`, over the WebView's `fetch` (the one Capacitor patches to go through the native
 * layer). It behaves like the server's (`server/http-client.ts`): forms are built with `FormData` and `Blob`
 * (the form astrometry.net accepts from the phone, `docs/dev/mobile/spike-results.md` decision 7), response
 * header names are lower-case, and a 4xx or 5xx status does not reject.
 *
 * Difference: the patched `fetch` may ignore an abort, so the timeout is a race between the request and a
 * timer that rejects (the abort is still signalled, for a `fetch` that honours it).
 */
import type { HttpClient, HttpRequest } from '@myastrosky/core/ports/http-client';

/** The part of a `fetch` response that the adapter reads. */
export interface FetchResponseLike {
  status: number;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string | FormData;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

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

export function createFetchHttpClient(options: { fetch: FetchLike }): HttpClient {
  return async (request) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const exchange = async () => {
      const res = await options.fetch(request.url, {
        method: request.method,
        ...(request.headers ? { headers: { ...request.headers } } : {}),
        body: toBody(request.body),
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      // The body is read inside the race, so a stalled body also times out.
      const buffer = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        headers,
        text: async () => new TextDecoder().decode(buffer),
        bytes: async () => buffer,
      };
    };

    try {
      if (request.timeoutMs === undefined) return await exchange();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out after ${request.timeoutMs} ms`));
        }, request.timeoutMs);
      });
      const pending = exchange();
      // If the timer wins, the request may still fail later: nobody listens, so keep that quiet.
      pending.catch(() => undefined);
      return await Promise.race([pending, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
