// @vitest-environment node
// happy-dom's Blob does not survive IndexedDB's structured clone; Node's does, as the WebView's does.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  addPendingPhoto,
  configurePendingStore,
  createIndexedDbPendingStore,
  loadPendingPhotos,
  pendingPhotoFile,
  pendingPhotos,
  removePendingPhoto,
  setPendingState,
} from '../src/pending-photos';

describe('the photos waiting to be placed, in the WebView database', () => {
  it('keeps the photos and their pictures across a restart, and changes and forgets them', async () => {
    const factory = new IDBFactory();
    configurePendingStore(createIndexedDbPendingStore(factory));
    const older = await addPendingPhoto(new Blob(['older'], { type: 'image/jpeg' }), 'M31.jpg');
    const newer = await addPendingPhoto(new Blob(['newer'], { type: 'image/png' }), 'M42.png');
    await setPendingState(older.id, 'failed', { error: 'no solution' });

    // A new store on the same database, as when the app starts again.
    configurePendingStore(createIndexedDbPendingStore(factory));
    await loadPendingPhotos();
    expect(pendingPhotos.value.map((p) => [p.name, p.state, p.error])).toEqual([
      ['M31.jpg', 'failed', 'no solution'],
      ['M42.png', 'toPlace', undefined],
    ]);
    const file = await pendingPhotoFile(newer.id);
    expect([file!.name, file!.type, await file!.text()]).toEqual(['M42.png', 'image/png', 'newer']);

    await removePendingPhoto(older.id);
    configurePendingStore(createIndexedDbPendingStore(factory));
    await loadPendingPhotos();
    expect(pendingPhotos.value.map((p) => p.id)).toEqual([newer.id]);
  });
});
