// Build-time constants injected by vite.config.ts from package.json.
// Values are substituted as string literals at compile time — never read at runtime.
declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIMESTAMP__: string;
declare const __APP_AUTHOR_NAME__: string;
declare const __APP_AUTHOR_EMAIL__: string;
declare const __APP_LICENSE__: string;

interface Window {
  myAstroDiagnostics?: {
    logError: (payload: {
      category: string;
      message: string;
      stack?: string;
      context?: Record<string, unknown>;
      code?: string;
      ref?: string;
    }) => Promise<{ ok: boolean; message?: string }>;
    getLogsDir: () => Promise<string>;
    getLogsPathHint: () => Promise<string>;
    openLogsDir: () => Promise<{ ok: boolean; message?: string }>;
  };
  /** Present in the desktop app only (electron/preload.ts). */
  electronAPI?: {
    getLocation: () => Promise<{ latitude: number; longitude: number }>;
    /** Photo files opened with "Open with MyAstroSky" before the page was ready. */
    takeOpenedFiles?: () => Promise<{ name: string; data: Uint8Array }[]>;
    onOpenedFiles?: (callback: (files: { name: string; data: Uint8Array }[]) => void) => void;
  };
}
