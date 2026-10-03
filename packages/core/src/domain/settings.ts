// Server settings / app-release shapes shared by the API client and the server.

/** Latest published GitHub release, as returned by the backend proxy `/api/version/latest`. */
export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface ServerSettings {
  apiKeySet: boolean;
  isWindows: boolean;
  ASTAP_PATH: string;
  SOLVE_FIELD_PATH: string;
  ASTROMETRY_DATA_DIR: string;
  USE_WSL_FOR_SOLVE_FIELD: boolean;
  USE_WSL_FOR_ASTAP: boolean;
  MAX_PARALLEL_SOLVES: string;
}

export interface SolverAvailability {
  solveField: boolean;
  astap: boolean;
  astrometry: boolean;
}
