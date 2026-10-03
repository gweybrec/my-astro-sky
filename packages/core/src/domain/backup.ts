// Export / import (sky data bundle) API shapes.

export interface ExportOptions {
  includeImages?: boolean;
  includeMetadata?: boolean;
  includeDsoOverrides?: boolean;
  includeCustomGear?: boolean;
  includeSetups?: boolean;
  includePlans?: boolean;
  includeShortcuts?: boolean;
  includePoiCategories?: boolean;
  includeSkyRegions?: boolean;
}

export interface ImportPreviewImage {
  filename: string;
  originalName: string;
  size: number;
  exists: boolean;
}

export interface ImportPreviewPlan {
  id: string;
  name: string;
  /** true if a plan with the same name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewSetup {
  id: string;
  name: string;
  /** true if a setup with the same name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewGear {
  id: string;
  type: string;
  name: string;
  /** true if gear of the same type + name already exists (will be replaced if imported). */
  exists: boolean;
}

export interface ImportPreviewResult {
  hasMetadata: boolean;
  photos: number;
  hasDsoOverrides: boolean;
  hasCustomGear: boolean;
  hasSetups: boolean;
  hasPoiCategories: boolean;
  hasSkyRegions: boolean;
  hasPlans: boolean;
  hasShortcuts: boolean;
  /** Parsed shortcuts.json content, applied client-side to localStorage on import. */
  shortcuts?: unknown;
  images: ImportPreviewImage[];
  plans: ImportPreviewPlan[];
  setups: ImportPreviewSetup[];
  gear: ImportPreviewGear[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  dsoOverridesImported?: number;
}

export interface ImportOptions {
  importMetadata: boolean;
  importDsoOverrides: boolean;
  importPoiCategories?: boolean;
  importSkyRegions?: boolean;
  /** null means no image filtering (metadata-only import). */
  selectedImages: string[] | null;
  /** ids of plans to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedPlans: string[] | null;
  /** ids of gear setups to import (name-collisions are replaced); null/empty ⇒ none. */
  selectedSetups: string[] | null;
  /** ids of custom gear to import (type+name-collisions are replaced); null/empty ⇒ none. */
  selectedGear: string[] | null;
}
