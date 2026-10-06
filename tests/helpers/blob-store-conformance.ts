/** Runs the `BlobStore` conformance cases (`@myastrosky/core/testing/blob-store-conformance`) under Vitest. */
import { describe, it } from 'vitest';
import type { BlobStore } from '@myastrosky/core/ports/blob-store';
import { blobStoreConformanceCases } from '@myastrosky/core/testing/blob-store-conformance';

export function describeBlobStoreConformance(name: string, open: () => Promise<BlobStore>): void {
  describe(`BlobStore conformance: ${name}`, () => {
    for (const c of blobStoreConformanceCases) {
      it(c.name, () => c.run(open));
    }
  });
}
