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
