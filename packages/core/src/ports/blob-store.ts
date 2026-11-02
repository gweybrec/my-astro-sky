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

/** The longest blob name: well under the 255 characters most file systems allow. */
const MAX_BLOB_NAME_LENGTH = 200;
/** Characters Windows refuses in a file name, folder separators among them (control characters are tested apart). */
const FORBIDDEN_CHARS_RE = /[<>:"/\\|?*]/;
const hasControlChar = (name: string): boolean => [...name].some((c) => c.charCodeAt(0) < 0x20);
/** Names Windows gives to devices, whatever the extension (`CON.jpg` is the console). */
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

/**
 * Whether `name` is a plain file name a store may use on every platform: not empty nor too long, no folder part or
 * character Windows refuses, no leading dot (hidden and `.part` files), no trailing dot or space (Windows drops them,
 * so `a.jpg.` would be `a.jpg`), and no device name. A name from outside (a backup) must pass before it reaches a
 * store.
 */
export function isSafeBlobName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name.length <= MAX_BLOB_NAME_LENGTH &&
    !FORBIDDEN_CHARS_RE.test(name) &&
    !hasControlChar(name) &&
    !name.startsWith('.') &&
    !/[. ]$/.test(name) &&
    !WINDOWS_DEVICE_RE.test(name)
  );
}
