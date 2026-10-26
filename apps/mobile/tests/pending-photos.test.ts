import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  loadPendingPhotos,
  pendingPhotoFile,
  pendingPhotos,
  removePendingPhoto,
  setPendingState,
  type PendingStore,
} from '../src/pending-photos';

describe('the photos waiting to be placed', () => {
  let store: PendingStore;
  beforeEach(() => {
    store = createMemoryPendingStore();
    configurePendingStore(store);
  });

  it('keeps a picture with its name, to place, and gives it back as a file', async () => {
    const added = await addPendingPhoto(new Blob(['abc'], { type: 'image/png' }), 'M42.png');
    expect(added).toMatchObject({ name: 'M42.png', state: 'toPlace' });
    expect(pendingPhotos.value).toEqual([added]);
    const file = await pendingPhotoFile(added.id);
    expect([file!.name, file!.type, await file!.text()]).toEqual(['M42.png', 'image/png', 'abc']);
    expect(await pendingPhotoFile('unknown')).toBeNull();
  });

  it('reads the kept photos again, oldest first, without their pictures', async () => {
    await store.put({ id: 'b', name: 'b.jpg', state: 'solving', addedAt: 20, picture: new Blob() });
    await store.put({ id: 'a', name: 'a.jpg', state: 'toPlace', addedAt: 10, picture: new Blob() });
    expect(pendingPhotos.value).toEqual([]);
    await loadPendingPhotos();
    expect(pendingPhotos.value).toEqual([
      { id: 'a', name: 'a.jpg', state: 'toPlace', addedAt: 10 },
      { id: 'b', name: 'b.jpg', state: 'solving', addedAt: 20 },
    ]);
  });

  it('changes where a photo stands and forgets it, in the list and in the store', async () => {
    const added = await addPendingPhoto(new Blob(['x']), 'M31.jpg');
    await setPendingState(added.id, 'solving');
    expect(pendingPhotos.value[0].state).toBe('solving');
    expect((await store.all())[0].state).toBe('solving');
    await setPendingState('unknown', 'failed');
    expect(await store.all()).toHaveLength(1);
    await removePendingPhoto(added.id);
    expect(pendingPhotos.value).toEqual([]);
    expect(await store.all()).toEqual([]);
  });
});
