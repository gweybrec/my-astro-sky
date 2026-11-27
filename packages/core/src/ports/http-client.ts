import { DomainError } from '../domain/errors';

/**
 * A file's content read only when needed (a `Blob` is one: the server's comes from `fs.openAsBlob`), so that a large
 * file sent on is not held in memory whole.
 */
export interface ByteSource {
  readonly size: number;
  slice(start?: number, end?: number): ByteSource;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Readonly<Record<string, string>>;
  /** A text body, or a multipart form (the phone sends a file this way; see `docs/dev/mobile-architecture.md`). */
  body?:
    | string
    | {
        form: ReadonlyArray<
          | { name: string; value: string }
          | { name: string; fileName: string; type: string; bytes: Uint8Array | ByteSource }
        >;
      };
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * What an `HttpClient` throws when no answer came: `NETWORK_TIMEOUT` when it waited `timeoutMs`,
 * else `NETWORK_ERROR` (no network, a refused connection). The screens translate both, and a solve
 * followed in the background takes them as "out of reach for now". The original error is the cause.
 */
export function httpFailure(cause: unknown, timedOutAfterMs?: number): DomainError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return timedOutAfterMs !== undefined
    ? Object.assign(
        new DomainError('upstream', `Request timed out after ${timedOutAfterMs} ms`, {
          code: 'NETWORK_TIMEOUT',
        }),
        { cause },
      )
    : Object.assign(new DomainError('upstream', detail, { code: 'NETWORK_ERROR' }), { cause });
}
