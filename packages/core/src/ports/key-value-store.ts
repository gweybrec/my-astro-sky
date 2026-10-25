/** Small texts kept on the device between sessions (the browser's localStorage; the phone's preferences). Synchronous: a platform whose storage is asynchronous loads it in memory at start-up and writes behind. */
export interface KeyValueStore {
  get(key: string): string | null;
  /** May throw when the value cannot be kept (storage full); callers that must report it catch it. */
  set(key: string, value: string): void;
  remove(key: string): void;
}
