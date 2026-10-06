/** Writes the files of a backup archive, one after the other. */
export interface BundleWriter {
  /** Adds one file. Resolves once the archive has taken it, so a caller that waits does not pile up the bytes of every file. */
  add(name: string, bytes: Uint8Array): Promise<void>;
}

/** Reads a backup archive. */
export interface BundleReader {
  /** The names of the files in the archive. */
  names(): Promise<string[]>;
  /** The bytes of one file, or null when the archive has no such file. */
  read(name: string): Promise<Uint8Array | null>;
  /** The uncompressed size of one file, or null. */
  size(name: string): Promise<number | null>;
}
