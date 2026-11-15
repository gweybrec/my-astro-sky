import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPendingPhoto,
  configurePendingStore,
  createMemoryPendingStore,
  loadPendingPhotos,
  pendingPhotoFile,
  pictureName,
  pendingPhotoSolveFile,
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

  it('names a kept picture with the extension of its type', () => {
    expect(pictureName('M38_processed.fit', 'image/png')).toBe('M38_processed.png');
    expect(pictureName('Veil.tiff', 'image/png')).toBe('Veil.png');
    expect(pictureName('M42.JPEG', 'image/jpeg')).toBe('M42.JPEG');
    expect(pictureName('M42', 'image/webp')).toBe('M42.webp');
    expect(pictureName('M42.fit', '')).toBe('M42.fit');
  });

  it('keeps a separate raw solve file without exposing it in the waiting-photo list', async () => {
    const raw = new File(['fits-bytes'], 'M42.fit', { type: 'application/fits' });
    const added = await addPendingPhoto(
      new Blob(['png-bytes'], { type: 'image/png' }),
      'M42.fit',
      undefined,
      raw,
    );

    const picture = await pendingPhotoFile(added.id);
    const solveFile = await pendingPhotoSolveFile(added.id);
    // The picture is named for what it is: the photo store and the solvers read a file by its extension.
    expect([picture!.name, picture!.type, await picture!.text()]).toEqual([
      'M42.png',
      'image/png',
      'png-bytes',
    ]);
    expect([solveFile!.name, solveFile!.type, await solveFile!.text()]).toEqual([
      'M42.fit',
      'application/fits',
      'fits-bytes',
    ]);
    expect(pendingPhotos.value[0]).toEqual(added);
    expect(pendingPhotos.value[0]).not.toHaveProperty('solvePicture');
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

  it('reads only the photo asked for, not every kept picture', async () => {
    const calls: string[] = [];
    const counted: PendingStore = {
      all: () => (calls.push('all'), store.all()),
      get: (id) => (calls.push('get'), store.get(id)),
      put: (record) => store.put(record),
      delete: (id) => store.delete(id),
    };
    configurePendingStore(counted);
    const added = await addPendingPhoto(new Blob(['x']), 'M31.jpg');
    await addPendingPhoto(new Blob(['y']), 'M42.jpg');
    await pendingPhotoFile(added.id);
    await setPendingState(added.id, 'solving');
    expect(calls).toEqual(['get', 'get']);
  });
});
