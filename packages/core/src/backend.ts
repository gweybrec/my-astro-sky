/**
 * The one object the app's data functions call (`src/api.ts`). On the desktop it is the HTTP backend
 * (`packages/backend-http`, which calls the server's routes); on the phone it is the local backend
 * (the services themselves). `testing/backend-contract.ts` holds the tests both must pass.
 *
 * Core has no DOM types, so a file, a progress callback and a cancellation have their own small types here.
 */
import type { NovaReuseResult, NovaSolveHints } from './domain/solve';
import type { LocalSolverApi } from './domain/solve';
import type {
  ExportRequest,
  ImportOptions,
  ImportPreviewResult,
  ImportResult,
} from './domain/backup';
import type { UploadFields } from './domain/photos';
import type { ConvertSolvedResult, SolveWcsResult } from './domain/solved-import';
import type { DsoOverrideService } from './services/dso-overrides';
import type { GearService } from './services/gear';
import type { HorizonService } from './services/horizon';
import type { IdentifyService } from './services/identify';
import type { NovaSolveService } from './services/nova-solve';
import type { PhotoService } from './services/photos';
import type { PlanService } from './services/plans';
import type { PoiCategoryService } from './services/poi-categories';
import type { SettingsService } from './services/settings';
import type { SkyRegionService } from './services/sky-regions';
import type { StarSearchService } from './services/star-search';
import type { VersionService } from './services/version';
import type { Photo } from './types';

/** A file chosen by the user, readable on demand. */
export interface FileSource {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The platform's own handle on the same file (a browser `File`), when there is one.
   *  A backend that can send it as it is does so, and never calls `read()`. */
  native?: unknown;
}

/** Satisfied by the browser's `AbortSignal`. */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface TransferOptions {
  /** Called with the fraction sent, from 0 to 1. A backend with nothing to send calls it once with 1. */
  onProgress?: (fraction: number) => void;
  cancel?: CancelSignal;
}

/**
 * Every method rejects with a `DomainError` (`kind`, `code`, `message`); nothing else is part of the
 * contract. The one exception is a cancelled transfer, which rejects with `DOMException('Aborted', 'AbortError')`.
 */
export interface Backend {
  /** What this backend can do; screens test these, never "am I on a phone". */
  capabilities: { localSolvers: boolean };
  /** The address a screen puts in an image's `src` for a stored photo or thumbnail file. */
  files: { url(fileName: string): string };
  catalog: {
    /** The address of the star catalogue file to load. */
    starCatalogUrl(): Promise<string>;
  };
  plans: Pick<
    PlanService,
    | 'list'
    | 'create'
    | 'reorder'
    | 'update'
    | 'remove'
    | 'addEntry'
    | 'reorderEntries'
    | 'removeEntry'
    | 'updateEntry'
    | 'createMosaic'
    | 'updateMosaic'
    | 'removeMosaic'
  >;
  photos: Pick<
    PhotoService,
    | 'listWithSizes'
    | 'remove'
    | 'removeMany'
    | 'removeAll'
    | 'updateMetadata'
    | 'setManualPlacement'
    | 'setOrder'
  > & {
    upload(file: FileSource, fields: UploadFields, options?: TransferOptions): Promise<Photo>;
  };
  gear: Pick<
    GearService,
    | 'listCatalog'
    | 'addCustom'
    | 'removeCustom'
    | 'removeAllCustom'
    | 'listSetups'
    | 'createSetup'
    | 'replaceSetup'
    | 'setSetupEnabled'
    | 'removeSetup'
    | 'removeAllSetups'
  >;
  dsoOverrides: Pick<DsoOverrideService, 'getAll' | 'upsert' | 'remove' | 'removeAll'>;
  poiCategories: Pick<PoiCategoryService, 'list' | 'create' | 'update' | 'remove'>;
  skyRegions: Pick<SkyRegionService, 'list' | 'create' | 'update' | 'remove'>;
  settings: Pick<SettingsService, 'readPublic' | 'update' | 'removeApiKey'>;
  stars: Pick<StarSearchService, 'search' | 'nearby' | 'getByHip'>;
  horizon: Pick<HorizonService, 'getProfile'>;
  identify: Pick<IdentifyService, 'searchAsteroids' | 'searchTransients' | 'getCometElements'>;
  version: Pick<VersionService, 'getLatest'>;
  novaSolve: Pick<NovaSolveService, 'getJob' | 'listSubmissions'> & {
    submit(file: FileSource, hints?: NovaSolveHints): Promise<string>;
    reuse(file: FileSource, jobId: number): Promise<NovaReuseResult>;
  };
  solvedImport: {
    solveWcs(
      file: FileSource,
      target?: { width?: number; height?: number },
    ): Promise<SolveWcsResult>;
    convert(file: FileSource, options?: TransferOptions): Promise<ConvertSolvedResult>;
  };
  backup: {
    /** Builds the backup and hands it to the user: a download on the desktop, the share sheet on the phone. */
    exportToUser(request: ExportRequest): Promise<void>;
    preview(file: FileSource): Promise<ImportPreviewResult>;
    restore(file: FileSource, options: ImportOptions): Promise<ImportResult>;
  };
  /** The solvers installed next to the server. Absent on a backend without them. */
  localSolvers?: LocalSolverApi;
}
