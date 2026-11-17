/**
 * The photos of "Ajouter des photos" not stored yet are kept in the browser's database (IndexedDB, in the app's own
 * data) until they are saved or given up, so that closing or killing the app loses neither them nor the
 * astrometry.net solve going on for them. Their files are written once, their details each time they change. At
 * start-up the window opens again with them (`restoreBatch`); a photo already stored is not kept here: the photo store
 * has it.
 */
import type { BatchItem } from './batch-types';
import { reportUnknownRendererError } from './error-reporter';

/** What is kept of a photo of the window besides its files: what was typed and found for it, and where it stands. */
export type KeptBatchState = Pick<
  BatchItem,
  | 'rawName'
  | 'solver'
  | 'hintCoords'
  | 'hintTargetName'
  | 'fovDeg'
  | 'wcsResult'
  | 'solveCorrespondences'
  | 'manualPlacement'
  | 'status'
  | 'placedBy'
  | 'wcsFileName'
  | 'online'
  | 'error'
  | 'diagnostics'
  | 'dsoIds'
  | 'labels'
  | 'pointsOfInterest'
  | 'integrations'
  | 'observationDate'
  | 'captureDetails'
  | 'gearSetupId'
  | 'fitsHeaders'
  | 'wcsNotice'
  | 'notes'
  | 'customName'
>;

/** A photo of the window as it is read back: its place in the list, its files and its state. */
export interface KeptBatchItem {
  id: string;
  order: number;
  file: File;
  rawFile: File | null;
  state: KeptBatchState;
}

/** Where the photos are kept. A `File` may not survive the database: its bytes, name and type are kept apart. */
export interface BatchKeepStore {
  all(): Promise<KeptBatchItem[]>;
  putFiles(id: string, file: File, rawFile: File | null): Promise<void>;
  putState(id: string, order: number, state: KeptBatchState): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'myastrosky-add-photos';
const FILES = 'files';
const STATES = 'states';

interface FilesRow {
  id: string;
  file: Blob;
  fileName: string;
  fileType: string;
  rawFile?: Blob;
  rawFileName?: string;
  rawFileType?: string;
}
interface StateRow {
  id: string;
  order: number;
  state: KeptBatchState;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** The store in the browser's database: the files in one table, the states in another. */
export function createIndexedDbBatchStore(factory: IDBFactory): BatchKeepStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(FILES, { keyPath: 'id' });
        open.result.createObjectStore(STATES, { keyPath: 'id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    });
    return opened;
  };
  const table = async (name: string, mode: IDBTransactionMode) =>
    (await db()).transaction(name, mode).objectStore(name);
  return {
    async all() {
      const states = await request<StateRow[]>((await table(STATES, 'readonly')).getAll());
      const files = await request<FilesRow[]>((await table(FILES, 'readonly')).getAll());
      const filesOf = new Map(files.map((f) => [f.id, f]));
      return states.flatMap((s) => {
        const f = filesOf.get(s.id);
        if (!f) return [];
        return [
          {
            id: s.id,
            order: s.order,
            state: s.state,
            file: new File([f.file], f.fileName, { type: f.fileType }),
            rawFile: f.rawFile
              ? new File([f.rawFile], f.rawFileName ?? f.fileName, { type: f.rawFileType ?? '' })
              : null,
          },
        ];
      });
    },
    async putFiles(id, file, rawFile) {
      const row: FilesRow = {
        id,
        file,
        fileName: file.name,
        fileType: file.type,
        ...(rawFile ? { rawFile, rawFileName: rawFile.name, rawFileType: rawFile.type } : {}),
      };
      await request((await table(FILES, 'readwrite')).put(row));
    },
    async putState(id, order, state) {
      await request(
        (await table(STATES, 'readwrite')).put({ id, order, state } satisfies StateRow),
      );
    },
    async delete(id) {
      await request((await table(STATES, 'readwrite')).delete(id));
      await request((await table(FILES, 'readwrite')).delete(id));
    },
    async clear() {
      await request((await table(STATES, 'readwrite')).clear());
      await request((await table(FILES, 'readwrite')).clear());
    },
  };
}

let store: BatchKeepStore | null = null;

/** Sets where the photos are kept (start-up, tests); none keeps nothing. */
export function configureBatchKeep(next: BatchKeepStore | null): void {
  store = next;
  written.clear();
}

/** A photo of the window kept until it is stored: one not stored yet. */
export const isKeptItem = (item: BatchItem): boolean => !item.photo;

/** What is kept of a photo, as plain data (the window's items are reactive). */
export function keptStateOf(item: BatchItem): KeptBatchState {
  const state: KeptBatchState = {
    rawName: item.rawName,
    solver: item.solver,
    hintCoords: item.hintCoords,
    hintTargetName: item.hintTargetName,
    fovDeg: item.fovDeg,
    wcsResult: item.wcsResult,
    solveCorrespondences: item.solveCorrespondences,
    manualPlacement: item.manualPlacement,
    status: item.status,
    placedBy: item.placedBy,
    wcsFileName: item.wcsFileName,
    online: item.online,
    error: item.error,
    diagnostics: item.diagnostics,
    dsoIds: item.dsoIds,
    labels: item.labels,
    pointsOfInterest: item.pointsOfInterest,
    integrations: item.integrations,
    observationDate: item.observationDate,
    captureDetails: item.captureDetails,
    gearSetupId: item.gearSetupId,
    fitsHeaders: item.fitsHeaders,
    wcsNotice: item.wcsNotice,
    notes: item.notes,
    customName: item.customName,
  };
  return JSON.parse(JSON.stringify(state)) as KeptBatchState;
}

/**
 * Where a photo stands when the app starts again. A solve astrometry.net goes on with is followed again from its
 * submission ("En cours", then fetched; nothing is sent again); a local solve, or an online one never given a
 * submission, stopped with the app: the photo is to solve again. A conversion is made again (the raw file is kept).
 */
export function stateAfterRestart(state: KeptBatchState): KeptBatchState {
  if (state.status !== 'solving' && state.status !== 'waiting') return state;
  if (state.online?.submissionId) {
    const { jobId: _jobId, ...online } = state.online;
    return { ...state, status: 'unfinished', online };
  }
  return { ...state, status: 'pending', online: null };
}

/** What was last written for each photo, so that only a change is written again. */
const written = new Map<
  string,
  { json: string; order: number; file: File; rawFile: File | null }
>();
let queue: Promise<void> = Promise.resolve();

/** Runs the writes one after the other; a failure is reported, and the window goes on as it was. */
function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((error) => reportUnknownRendererError('batch-keep', error));
  return queue;
}

/** One photo of the window, as the window hands it over to be kept. */
export interface KeptEntry {
  id: string;
  file: File;
  rawFile: File | null;
  state: KeptBatchState;
}

/**
 * Keeps the photos of the window as they are now (in their order), and forgets those no longer in it or stored since.
 * Only what changed is written: the files once (again after a conversion), the state when it changes.
 */
export function keepBatch(entries: KeptEntry[]): Promise<void> {
  const target = store;
  if (!target) return Promise.resolve();
  const wanted = new Set(entries.map((e) => e.id));
  const writes: (() => Promise<void>)[] = [];
  entries.forEach((entry, order) => {
    const before = written.get(entry.id);
    const json = JSON.stringify(entry.state);
    if (!before || before.file !== entry.file || before.rawFile !== entry.rawFile) {
      writes.push(() => target.putFiles(entry.id, entry.file, entry.rawFile));
    }
    if (!before || before.json !== json || before.order !== order) {
      writes.push(() => target.putState(entry.id, order, entry.state));
    }
    written.set(entry.id, { json, order, file: entry.file, rawFile: entry.rawFile });
  });
  for (const id of [...written.keys()]) {
    if (wanted.has(id)) continue;
    written.delete(id);
    writes.push(() => target.delete(id));
  }
  if (writes.length === 0) return queue;
  return enqueue(async () => {
    for (const write of writes) await write();
  });
}

/** Forgets every kept photo: the window was closed (its photos saved, or given up). */
export function forgetBatch(): Promise<void> {
  const target = store;
  written.clear();
  if (!target) return Promise.resolve();
  return enqueue(() => target.clear());
}

/**
 * Reads back the photos kept when the app was left, in their order, each as it stands after the restart; none when
 * nothing was kept or the database cannot be read.
 */
export async function restoreBatch(): Promise<KeptBatchItem[]> {
  if (!store) return [];
  try {
    const kept = (await store.all()).sort((a, b) => a.order - b.order);
    for (const k of kept) {
      written.set(k.id, {
        json: JSON.stringify(k.state),
        order: k.order,
        file: k.file,
        rawFile: k.rawFile,
      });
    }
    return kept.map((k) => ({ ...k, state: stateAfterRestart(k.state) }));
  } catch (error) {
    reportUnknownRendererError('batch-keep-restore', error);
    return [];
  }
}
