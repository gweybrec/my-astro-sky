import { computed, reactive, ref } from 'vue';
import { t } from '@myastrosky/core/i18n/index';
import { formatBytes } from '@myastrosky/core/format-utils';
import { replaceUserOverrides } from '@myastrosky/core/catalog/dso-registry';
import { sortGalleryPhotos } from '@myastrosky/core/gallery-filter';
import {
  buildImportOptions,
  canImport,
  SETUP_CHOICES,
  setupChoiceMissing,
  setupConflictWarningKey,
  setupLocked,
  setupNeedsChoice,
  setupTicked,
  tickedPlanNamesBySetup,
  type ImportSelection,
} from '@myastrosky/core/backup-selection';
import type { SetupImportChoice } from '@myastrosky/core/domain/backup';
import {
  getDsoOverrides,
  importData,
  importPreview,
  type ImportPreviewResult,
} from '@myastrosky/app-state/api';
import { gallerySort } from '../gallery-display';
import { BACKUP_FILE_TYPES, pickFile } from '../platform-device';

// The restore of a backup, shared by the steps of the restore screen (boards "Restaurer, photos", "…, setups",
// "…, plans", "…, le reste"): the file read on the backup page, what is ticked and the choices made, kept while the
// steps are gone through back and forth.

/** The steps, in order; a step the backup has nothing for is left out. */
export type RestoreStep = 'photos' | 'setups' | 'plans' | 'other';
export type ListKey = 'images' | 'plans' | 'setups' | 'gear';

export interface RestoreRow {
  id: string;
  title: string;
  subs: string[];
  warn: string[];
  locked?: boolean;
}
export interface RestoreSection {
  list: ListKey;
  title: string;
  rows: RestoreRow[];
}

const file = ref<File | null>(null);
const preview = ref<ImportPreviewResult | null>(null);
/** The chosen file is being read (picked, then previewed). */
const reading = ref(false);
const importing = ref(false);
const setupChoices = reactive<Record<string, SetupImportChoice>>({});
/** The name a setup kept beside the local one is imported under, filled with its own name when chosen. */
const setupNames = reactive<Record<string, string>>({});
const sel = reactive({
  importDso: true,
  importPoiCategories: true,
  importSkyRegions: true,
  images: new Set<string>(),
  plans: new Set<string>(),
  setups: new Set<string>(),
  gear: new Set<string>(),
});

function selection(): ImportSelection {
  return { ...sel, importShortcuts: false, setupChoices, setupNames };
}

function clearSetupChoices() {
  for (const k of Object.keys(setupChoices)) delete setupChoices[k];
  for (const k of Object.keys(setupNames)) delete setupNames[k];
}

function reset() {
  file.value = null;
  preview.value = null;
  clearSetupChoices();
}

const steps = computed<RestoreStep[]>(() => {
  const p = preview.value;
  if (!p) return [];
  const out: RestoreStep[] = [];
  if (p.images.length) out.push('photos');
  if (p.setups.length) out.push('setups');
  if (p.plans.length) out.push('plans');
  if (p.hasDsoOverrides || p.hasPoiCategories || p.hasSkyRegions || p.gear.length)
    out.push('other');
  return out;
});

const canRestore = computed(
  () =>
    !!preview.value &&
    !importing.value &&
    !reading.value &&
    canImport(preview.value, selection()) &&
    !setupChoiceMissing(preview.value, selection()),
);

/** Each differing setup that will be imported has been told what to do. */
const setupsChosen = computed(
  () => !!preview.value && !setupChoiceMissing(preview.value, selection()),
);

const setupOptions = computed(() =>
  SETUP_CHOICES.map((c) => ({ value: c.value, label: t(c.label) })),
);

/** A ticked setup that differs from a local one is told what to do (nothing is chosen at first); unticked, it is
 * not imported. */
function needsChoice(id: string): boolean {
  const p = preview.value;
  const s = p?.setups.find((x) => x.id === id);
  return !!p && !!s && setupNeedsChoice(p, sel, s);
}

function chooseSetup(id: string, choice: SetupImportChoice | undefined) {
  const p = preview.value;
  const s = p?.setups.find((x) => x.id === id);
  if (!p || !s || !choice) return;
  setupChoices[id] = choice;
  if (choice === 'keepBoth' && setupNames[id] === undefined) setupNames[id] = s.name;
}

/** Picks a backup and reads it; true when one was read (the restore screen can open). */
async function chooseFile(): Promise<boolean> {
  if (reading.value || importing.value) return false;
  reading.value = true;
  try {
    const picked = await pickFile(BACKUP_FILE_TYPES);
    if (!picked) return false;
    const result = await importPreview(picked);
    file.value = picked;
    preview.value = result;
    clearSetupChoices();
    // Everything is ticked at first; a setup identical to a local one has nothing to tick.
    sel.importDso = sel.importPoiCategories = sel.importSkyRegions = true;
    sel.images = new Set(result.images.map((i) => i.filename));
    sel.plans = new Set(result.plans.map((p) => p.id));
    sel.setups = new Set(result.setups.filter((s) => s.conflict !== 'identical').map((s) => s.id));
    sel.gear = new Set(result.gear.map((g) => g.id));
    return true;
  } finally {
    reading.value = false;
  }
}

function toggle(list: ListKey, id: string, on: boolean) {
  const next = new Set(sel[list]);
  if (on) next.add(id);
  else next.delete(id);
  sel[list] = next;
  if (list === 'setups' && !on) delete setupChoices[id];
}

function allTicked(list: ListKey, ids: string[]) {
  return ids.length > 0 && ids.every((id) => sel[list].has(id));
}

function toggleAll(list: ListKey, ids: string[], on: boolean) {
  sel[list] = on ? new Set(ids) : new Set();
  if (list === 'setups' && !on) clearSetupChoices();
}

const REPLACE_WARNING = () => t('settings.importReplaceWarning');

/** The list a step shows: the photos in the gallery's order, the other lists in the backup's. */
function section(list: ListKey): RestoreSection | null {
  const p = preview.value;
  if (!p) return null;
  if (list === 'images' && p.images.length)
    return {
      list,
      title: t('settings.importImagesSection', { n: p.images.length }),
      rows: sortGalleryPhotos(p.images, gallerySort.value).map((i) => ({
        id: i.filename,
        title: i.originalName,
        subs: [formatBytes(i.size)],
        warn: i.exists ? [REPLACE_WARNING()] : [],
      })),
    };
  if (list === 'plans' && p.plans.length)
    return {
      list,
      title: t('settings.importPlansSection', { n: p.plans.length }),
      rows: p.plans.map((x) => ({
        id: x.id,
        title: x.name,
        subs: [],
        warn: x.exists ? [REPLACE_WARNING()] : [],
      })),
    };
  if (list === 'setups' && p.setups.length)
    return {
      list,
      title: t('settings.importSetupsSection', { n: p.setups.length }),
      rows: p.setups.map((s) => {
        const locked = setupLocked(p, sel.plans, s);
        // The plans a setup is locked by are named under it, as on the desktop: the plans come at the next step.
        const plans = tickedPlanNamesBySetup(p, sel.plans).get(s.id) ?? [];
        return {
          id: s.id,
          title: s.name,
          subs:
            s.conflict === 'identical'
              ? [t('settings.importSetupIdentical')]
              : locked
                ? [t('settings.importSetupWithPlan', { name: plans.join(', ') })]
                : [],
          // The line asks for a choice, then says what the choice does.
          warn: setupNeedsChoice(p, sel, s) ? [t(setupConflictWarningKey(setupChoices[s.id]))] : [],
          locked: s.conflict === 'identical' || locked,
        };
      }),
    };
  if (list === 'gear' && p.gear.length)
    return {
      list,
      title: t('settings.importGearSection', { n: p.gear.length }),
      rows: p.gear.map((g) => ({
        id: g.id,
        title: g.name,
        subs: [],
        warn: g.exists ? [REPLACE_WARNING()] : [],
      })),
    };
  return null;
}

function ticked(s: RestoreSection, id: string): boolean {
  const p = preview.value!;
  if (s.list === 'setups') {
    const setup = p.setups.find((x) => x.id === id)!;
    return setupTicked(p, sel, setup);
  }
  return sel[s.list].has(id);
}

/** The ids "Tout sélectionner" acts on: the setups identical to a local one are never ticked. */
function selectableIds(s: RestoreSection): string[] {
  const p = preview.value!;
  return s.rows
    .filter(
      (r) => s.list !== 'setups' || p.setups.find((x) => x.id === r.id)?.conflict !== 'identical',
    )
    .map((r) => r.id);
}

/** Restores what is ticked; the lines of the result, or null when nothing was restored. Errors are thrown. The
 * backup stays read until {@link reset}: the steps stay shown while the result is. */
async function restore(): Promise<string[] | null> {
  const p = preview.value;
  if (!p || !file.value || !canRestore.value) return null;
  importing.value = true;
  try {
    const result = await importData(file.value, buildImportOptions(p, selection()));
    const lines = [t('settings.importSuccess', { n: result.imported, s: result.skipped })];
    if (result.dsoOverridesImported) {
      lines.push(t('settings.importedDsoOverrides', { n: result.dsoOverridesImported }));
      try {
        replaceUserOverrides(await getDsoOverrides());
      } catch {
        /* the overrides are read again at the next start */
      }
    }
    if (result.failed?.length) {
      lines.push(
        t('settings.importFailedItems', { names: result.failed.map((f) => f.name).join(', ') }),
      );
    }
    return lines;
  } finally {
    importing.value = false;
  }
}

export function useRestore() {
  return {
    file,
    preview,
    reading,
    importing,
    sel,
    setupChoices,
    setupNames,
    steps,
    canRestore,
    setupsChosen,
    setupOptions,
    needsChoice,
    chooseSetup,
    chooseFile,
    toggle,
    allTicked,
    toggleAll,
    section,
    ticked,
    selectableIds,
    restore,
    reset,
  };
}
