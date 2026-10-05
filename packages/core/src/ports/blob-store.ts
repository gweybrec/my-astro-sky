export interface BlobStore {
  put(name: string, bytes: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array | null>;
  /** Size in bytes, or null when there is no such blob. */
  size(name: string): Promise<number | null>;
  /** Removes the blob; a missing one is not an error. */
  remove(name: string): Promise<void>;
}
