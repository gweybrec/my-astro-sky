/**
 * The photos that are imported but not on the sky yet: waiting for a placement method ("À placer") or being solved
 * online ("Résolution"). The photo store only takes a photo with its placement, so until then the phone keeps the
 * picture itself, in the WebView's own database (IndexedDB, in the app's private data), with a small record. Once a
 * photo is placed it is stored as an ordinary photo and leaves this list.
 */
import { shallowRef } from 'vue';

/** `toPlace`: needs a placement method. `solving`: sent to the online solver. `failed`: the solve did not succeed. */
export type PendingState = 'toPlace' | 'solving' | 'failed';

export interface PendingPhoto {
  id: string;
  /** The file's name as it was picked. */
  name: string;
  state: PendingState;
  /** When it was imported (milliseconds); the list is in this order. */
  addedAt: number;
}

interface StoredPending extends PendingPhoto {
  picture: Blob;
}

/** Where the records and their pictures are kept. */
export interface PendingStore {
  all(): Promise<StoredPending[]>;
  put(record: StoredPending): Promise<void>;
  delete(id: string): Promise<void>;
}

const DB_NAME = 'myastrosky-pending-photos';
const STORE = 'photos';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** The store in the WebView's database. */
export function createIndexedDbPendingStore(factory: IDBFactory): PendingStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    });
    return opened;
  };
  const store = async (mode: IDBTransactionMode) =>
    (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    all: async () => request<StoredPending[]>((await store('readonly')).getAll()),
    put: async (record) => void (await request((await store('readwrite')).put(record))),
    delete: async (id) => void (await request((await store('readwrite')).delete(id))),
  };
}

/** A store that lasts as long as the page (tests, and a browser without a database). */
export function createMemoryPendingStore(): PendingStore {
  const records = new Map<string, StoredPending>();
  return {
    all: async () => [...records.values()],
    put: async (record) => void records.set(record.id, record),
    delete: async (id) => void records.delete(id),
  };
}

let store: PendingStore =
  typeof indexedDB === 'undefined'
    ? createMemoryPendingStore()
    : createIndexedDbPendingStore(indexedDB);

/** Replaces the store (tests). */
export function configurePendingStore(next: PendingStore): void {
  store = next;
  pendingPhotos.value = [];
}

/** The photos waiting to be placed, oldest first. Filled by `loadPendingPhotos`. */
export const pendingPhotos = shallowRef<PendingPhoto[]>([]);

const recordOf = ({ id, name, state, addedAt }: StoredPending): PendingPhoto => ({
  id,
  name,
  state,
  addedAt,
});

/** Reads the list again from the store. */
export async function loadPendingPhotos(): Promise<void> {
  const all = await store.all();
  pendingPhotos.value = all.sort((a, b) => a.addedAt - b.addedAt).map(recordOf);
}

/** Keeps a picture that has no placement yet. */
export async function addPendingPhoto(picture: Blob, name: string): Promise<PendingPhoto> {
  const record: StoredPending = {
    id: crypto.randomUUID(),
    name,
    state: 'toPlace',
    addedAt: Date.now(),
    picture,
  };
  await store.put(record);
  const added = recordOf(record);
  pendingPhotos.value = [...pendingPhotos.value, added];
  return added;
}

/** The picture of a waiting photo as a file to place or solve; null when it is no longer kept. */
export async function pendingPhotoFile(id: string): Promise<File | null> {
  const found = (await store.all()).find((r) => r.id === id);
  return found ? new File([found.picture], found.name, { type: found.picture.type }) : null;
}

/** Changes where a waiting photo stands. */
export async function setPendingState(id: string, state: PendingState): Promise<void> {
  const found = (await store.all()).find((r) => r.id === id);
  if (!found) return;
  await store.put({ ...found, state });
  pendingPhotos.value = pendingPhotos.value.map((p) => (p.id === id ? { ...p, state } : p));
}

/** Forgets a waiting photo (it was placed, or removed). */
export async function removePendingPhoto(id: string): Promise<void> {
  await store.delete(id);
  pendingPhotos.value = pendingPhotos.value.filter((p) => p.id !== id);
}
