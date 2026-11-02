export interface BlobStore {
  /**
   * Writes the blob, replacing any blob of that name only once every byte is written: a put that fails leaves the
   * old blob as it was.
   */
  put(name: string, bytes: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array | null>;
  /** Size in bytes, or null when there is no such blob. */
  size(name: string): Promise<number | null>;
  /** Removes the blob; a missing one is not an error. */
  remove(name: string): Promise<void>;
}

/**
 * Whether `name` is a plain file name a store may use: not empty, no folder part, no drive or stream colon, and no
 * leading dot (hidden and `.part` files). A name from outside (a backup) must pass before it reaches a store.
 */
export function isSafeBlobName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && !/[/\\:\0]/.test(name) && !name.startsWith('.');
}
