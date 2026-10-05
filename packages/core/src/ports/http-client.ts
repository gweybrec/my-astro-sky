export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Readonly<Record<string, string>>;
  /** A text body, or a multipart form (the phone sends a file this way; see `docs/dev/mobile/spike-results.md`). */
  body?:
    | string
    | {
        form: ReadonlyArray<
          | { name: string; value: string }
          | { name: string; fileName: string; type: string; bytes: Uint8Array }
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
