import type { PhotoIntegration } from '@myastrosky/core/types';
import type { BatchItem } from './batch-types';

export const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

export function normalizeIntegrationFilterKey(value: string): string {
  return value.trim().toLowerCase();
}

export function sanitizeIntegrationRows(rows: PhotoIntegration[]): PhotoIntegration[] {
  return rows.map((row) => ({
    frames:
      Number.isInteger(Number(row.frames)) && Number(row.frames) >= 0 ? Number(row.frames) : 0,
    seconds:
      Number.isInteger(Number(row.seconds)) && Number(row.seconds) >= 0 ? Number(row.seconds) : 0,
    filter: row.filter.trim(),
  }));
}

/**
 * "Retirer le placement": the item is back to "À résoudre", its solution and the metadata the solved file filled in
 * (objects, date, integrations, header cards) dropped. Labels, name and notes are kept. A saved photo is then
 * "À réenregistrer".
 */
export function clearWcsSolution(item: BatchItem): void {
  item.wcsResult = null;
  item.solveCorrespondences = null;
  item.manualPlacement = null;
  if (item.status === 'success') item.status = 'pending';
  item.placedBy = undefined;
  item.wcsFileName = undefined;
  item.dsoIds = [];
  item.observationDate = '';
  item.integrations = [];
  item.fitsHeaders = null;
  item.wcsNotice = '';
  markChanged(item, { placement: true });
}

/** The item is placed: it has reference points or a manual placement. */
export function isItemPlaced(item: BatchItem): boolean {
  return item.status === 'success';
}

/** A run of "Résoudre N photos" takes it: never placed, or failed or canceled; not being read, solved or waited for. */
export function isSolvable(item: BatchItem): boolean {
  return item.status === 'pending' || item.status === 'failed' || item.status === 'canceled';
}

/** "Enregistrer N photos" takes it: never saved, or changed since; not while it is being solved or saved. */
export function needsSaving(item: BatchItem): boolean {
  if (item.saveState === 'saved' || item.saveState === 'saving') return false;
  return item.status !== 'solving' && item.status !== 'waiting' && item.status !== 'converting';
}

/** Something about a saved photo changed: it is "À réenregistrer". `placement`: its placement changed. */
export function markChanged(item: BatchItem, what: { placement?: boolean } = {}): void {
  if (what.placement) item.placementSaved = false;
  if (item.saveState === 'saved') item.saveState = 'modified';
}

/** The list's filters, in their order. */
export type BatchFilter = 'all' | 'toPlace' | 'failed' | 'unsaved' | 'saved';
export const BATCH_FILTERS: readonly BatchFilter[] = [
  'all',
  'toPlace',
  'failed',
  'unsaved',
  'saved',
];

/** The item is shown under the filter. */
export function matchesFilter(item: BatchItem, filter: BatchFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'toPlace':
      return !isItemPlaced(item) && item.status !== 'failed' && item.status !== 'canceled';
    case 'failed':
      return item.status === 'failed' || item.status === 'canceled';
    case 'unsaved':
      return item.saveState !== 'saved';
    case 'saved':
      return item.saveState === 'saved';
  }
}

export interface BatchCounts {
  /** Taken by "Résoudre N photos". */
  toSolve: number;
  /** Taken by "Enregistrer N photos". */
  toSave: number;
  /** Being solved or waiting for a local solver. */
  solving: number;
  /** Shown beside each filter. */
  byFilter: Record<BatchFilter, number>;
}

export function batchCounts(items: readonly BatchItem[]): BatchCounts {
  const byFilter = Object.fromEntries(
    BATCH_FILTERS.map((f) => [f, items.filter((i) => matchesFilter(i, f)).length]),
  ) as Record<BatchFilter, number>;
  return {
    toSolve: items.filter(isSolvable).length,
    toSave: items.filter(needsSaving).length,
    solving: items.filter((i) => i.status === 'solving' || i.status === 'waiting').length,
    byFilter,
  };
}

/** The placement chip: which state, and its tone (the chip's colour). */
export interface BatchChip {
  key: string;
  params?: Record<string, string>;
  tone: 'todo' | 'run' | 'fail' | 'ok' | 'warn' | 'saved';
}

export function placementChip(item: BatchItem): BatchChip {
  switch (item.status) {
    case 'converting':
      return { key: 'batch.statusConverting', tone: 'run' };
    case 'waiting':
      return { key: 'batch.chipWaiting', tone: 'run' };
    case 'solving':
      return { key: 'mobile.gallery.solving', tone: 'run' };
    case 'failed':
      return { key: 'batch.chipFailed', tone: 'fail' };
    case 'canceled':
      return { key: 'batch.chipCanceled', tone: 'fail' };
    case 'unfinished':
      return { key: 'mobile.gallery.unfinished', tone: 'warn' };
    case 'success':
      switch (item.placedBy) {
        case 'file':
          return { key: 'mobile.gallery.alreadySolved', tone: 'ok' };
        case 'hand':
          return { key: 'mobile.gallery.placedByHand', tone: 'ok' };
        case 'stars':
          return {
            key: 'mobile.gallery.placedByStars',
            params: { n: String(item.solveCorrespondences?.length ?? 3) },
            tone: 'ok',
          };
        default:
          return { key: 'mobile.gallery.placedSolved', tone: 'ok' };
      }
    default:
      return { key: 'batch.chipToSolve', tone: 'todo' };
  }
}

export function saveChip(item: BatchItem): BatchChip {
  switch (item.saveState) {
    case 'saved':
      return { key: 'batch.chipSaved', tone: 'saved' };
    case 'modified':
      return { key: 'batch.chipResave', tone: 'warn' };
    case 'saving':
      return { key: 'batch.statusSaving', tone: 'run' };
    default:
      return { key: 'batch.chipUnsaved', tone: 'warn' };
  }
}

/** The value the ticked items share, or `mixed` when they differ ("Valeurs différentes"). */
export function commonValue<T>(
  items: readonly BatchItem[],
  read: (item: BatchItem) => T,
): { mixed: false; value: T } | { mixed: true } {
  if (items.length === 0) return { mixed: true };
  const first = JSON.stringify(read(items[0]));
  return items.every((i) => JSON.stringify(read(i)) === first)
    ? { mixed: false, value: read(items[0]) }
    : { mixed: true };
}

/** The labels every ticked item has ("Étiquettes communes"), and those only some have (shown dashed). */
export function commonLabels(items: readonly BatchItem[]): { all: string[]; some: string[] } {
  if (items.length === 0) return { all: [], some: [] };
  const every = items[0].labels.filter((l) => items.every((i) => i.labels.includes(l)));
  const some = [...new Set(items.flatMap((i) => i.labels))].filter((l) => !every.includes(l));
  return { all: every, some };
}
