/**
 * What the export and import screens decide before calling the backup functions: which options an export asks
 * for, how big it will be, and, for an import, which setups are locked or need a choice and what options to send.
 * Shared by the desktop's export / import windows and the phone's screen.
 */
import type {
  ExportOptions,
  ImportOptions,
  ImportPreviewResult,
  ImportPreviewSetup,
  SetupImportChoice,
} from './domain/backup';

// ─── Export ───────────────────────────────────────────────────────────────────

/** The export's tick boxes (the photos are chosen apart). */
export interface ExportFlags {
  dsoOverrides: boolean;
  customGear: boolean;
  setups: boolean;
  poiCategories: boolean;
  skyRegions: boolean;
  plans: boolean;
  shortcuts: boolean;
}

/** The options of an export: images come with the selected photos, and photo metadata always travels with them. */
export function buildExportOptions(flags: ExportFlags, selectedPhotoCount: number): ExportOptions {
  return {
    includeImages: selectedPhotoCount > 0,
    includeMetadata: true,
    includeDsoOverrides: flags.dsoOverrides,
    includeCustomGear: flags.customGear,
    includeSetups: flags.setups,
    includePoiCategories: flags.poiCategories,
    includeSkyRegions: flags.skyRegions,
    includePlans: flags.plans,
    includeShortcuts: flags.shortcuts,
  };
}

/**
 * Every photo with its images and everything else but the shortcuts (the client keeps those): the backup offered when
 * a database update failed at start-up.
 */
export const FULL_BACKUP_OPTIONS: ExportOptions = {
  includeImages: true,
  includeMetadata: true,
  includeDsoOverrides: true,
  includeCustomGear: true,
  includeSetups: true,
  includePoiCategories: true,
  includeSkyRegions: true,
  includePlans: true,
  includeShortcuts: false,
};

/** An export needs at least one thing in it. */
export function canExport(flags: ExportFlags, selectedPhotoCount: number): boolean {
  return selectedPhotoCount > 0 || Object.values(flags).some(Boolean);
}

/** The size in bytes of the selected photos' files (a photo with no known size counts for 0). */
export function selectedPhotoBytes(
  photos: readonly { id: string; fileSize?: number | null }[],
  selected: ReadonlySet<string>,
): number {
  return photos.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (p.fileSize ?? 0), 0);
}

// ─── Import ───────────────────────────────────────────────────────────────────

/** What the user has ticked in an import preview. */
export interface ImportSelection {
  importDso: boolean;
  importPoiCategories: boolean;
  importSkyRegions: boolean;
  importShortcuts: boolean;
  images: ReadonlySet<string>;
  plans: ReadonlySet<string>;
  setups: ReadonlySet<string>;
  gear: ReadonlySet<string>;
  /** Choice per setup id, for the setups whose content differs from a local one. */
  setupChoices: Readonly<Record<string, SetupImportChoice>>;
  /** Name per setup id for a setup kept beside the local one (`keepBoth`); absent: the setup's own name. */
  setupNames?: Readonly<Record<string, string>>;
}

/** Names of the ticked plans whose setup is `setupId`, by setup id. */
export function tickedPlanNamesBySetup(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of preview.plans) {
    if (!p.setupId || !tickedPlans.has(p.id)) continue;
    map.set(p.setupId, [...(map.get(p.setupId) ?? []), p.name]);
  }
  return map;
}

/** A ticked plan needs this setup. */
export function setupRequired(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
  s: ImportPreviewSetup,
): boolean {
  return (tickedPlanNamesBySetup(preview, tickedPlans).get(s.id) ?? []).length > 0;
}

/** A setup with no local counterpart that a ticked plan needs: shown ticked, cannot be unticked. */
export function setupLocked(
  preview: ImportPreviewResult,
  tickedPlans: ReadonlySet<string>,
  s: ImportPreviewSetup,
): boolean {
  return s.conflict === 'none' && setupRequired(preview, tickedPlans, s);
}

/** A setup is imported: ticked (or locked); one identical to a local setup is never imported. */
export function setupTicked(
  preview: ImportPreviewResult,
  sel: Pick<ImportSelection, 'plans' | 'setups'>,
  s: ImportPreviewSetup,
): boolean {
  return s.conflict !== 'identical' && (sel.setups.has(s.id) || setupLocked(preview, sel.plans, s));
}

/**
 * A ticked setup that differs from a local one must be told what to do. Unticked, it is not imported: a ticked plan
 * that needs it is pointed at the local setup.
 */
export function setupNeedsChoice(
  _preview: ImportPreviewResult,
  sel: Pick<ImportSelection, 'setups'>,
  s: ImportPreviewSetup,
): boolean {
  return s.conflict === 'different' && sel.setups.has(s.id);
}

/** The choices offered for a different setup, in order, with the i18n key of each label (unticking it skips it). */
export const SETUP_CHOICES: readonly { value: SetupImportChoice; label: string }[] = [
  { value: 'replace', label: 'settings.importSetupReplace' },
  { value: 'keepBoth', label: 'settings.importSetupKeepBoth' },
];

/** The name a setup kept beside the local one is imported under: the one typed, else its own. */
export function keptSetupName(
  sel: Pick<ImportSelection, 'setupNames'>,
  s: ImportPreviewSetup,
): string {
  return sel.setupNames?.[s.id] ?? s.name;
}

/** A setup that needs a choice has none yet, or is kept with a blank name: the import cannot start. */
export function setupChoiceMissing(preview: ImportPreviewResult, sel: ImportSelection): boolean {
  return preview.setups.some((s) => {
    if (!setupNeedsChoice(preview, sel, s)) return false;
    const choice = sel.setupChoices[s.id];
    return !choice || (choice === 'keepBoth' && !keptSetupName(sel, s).trim());
  });
}

/** The i18n key of the line under a setup whose name exists here: it asks for a choice, then says what it does. */
export function setupConflictWarningKey(choice: SetupImportChoice | undefined): string {
  if (choice === 'replace') return 'settings.importReplaceWarning';
  if (choice === 'keepBoth') return 'settings.importSetupKeepBothWarning';
  return 'settings.importSetupChooseWarning';
}

/** At least one thing is ticked. */
export function canImport(preview: ImportPreviewResult, sel: ImportSelection): boolean {
  return (
    sel.images.size > 0 ||
    sel.plans.size > 0 ||
    sel.setups.size > 0 ||
    sel.gear.size > 0 ||
    (preview.hasDsoOverrides && sel.importDso) ||
    (preview.hasPoiCategories && sel.importPoiCategories) ||
    (preview.hasSkyRegions && sel.importSkyRegions) ||
    (preview.hasShortcuts && sel.importShortcuts)
  );
}

/** The options to send to the restore: the choices are kept for the setups that need one. */
export function buildImportOptions(
  preview: ImportPreviewResult,
  sel: ImportSelection,
): ImportOptions {
  return {
    // Photo metadata always travels with the photos that get imported.
    importMetadata: preview.hasMetadata,
    importDsoOverrides: preview.hasDsoOverrides && sel.importDso,
    importPoiCategories: preview.hasPoiCategories && sel.importPoiCategories,
    importSkyRegions: preview.hasSkyRegions && sel.importSkyRegions,
    selectedImages: preview.images.length > 0 ? Array.from(sel.images) : null,
    selectedPlans: Array.from(sel.plans),
    selectedSetups: Array.from(sel.setups),
    selectedGear: Array.from(sel.gear),
    setupConflicts: Object.fromEntries(
      preview.setups
        .filter((s) => setupNeedsChoice(preview, sel, s) && sel.setupChoices[s.id])
        .map((s) => [s.id, sel.setupChoices[s.id]]),
    ),
    setupNames: Object.fromEntries(
      preview.setups
        .filter((s) => setupNeedsChoice(preview, sel, s) && sel.setupChoices[s.id] === 'keepBoth')
        .map((s) => [s.id, keptSetupName(sel, s).trim()]),
    ),
  };
}
