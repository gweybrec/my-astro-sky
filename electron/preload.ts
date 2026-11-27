import { contextBridge, ipcRenderer } from 'electron';

export interface RendererErrorPayload {
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  code?: string;
  ref?: string;
}

contextBridge.exposeInMainWorld('myAstroDiagnostics', {
  logError: (payload: RendererErrorPayload) => ipcRenderer.invoke('diagnostics:log-error', payload),
  getLogsDir: () => ipcRenderer.invoke('diagnostics:get-logs-dir'),
  getLogsPathHint: () => ipcRenderer.invoke('diagnostics:get-logs-path-hint'),
  openLogsDir: () => ipcRenderer.invoke('diagnostics:open-logs-dir'),
});

/** A photo file opened with "Open with MyAstroSky" (its name and bytes). */
export interface OpenedFile {
  name: string;
  data: Uint8Array;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getLocation: () => ipcRenderer.invoke('get-location'),
  /** Files opened before the page was ready; afterwards they arrive through `onOpenedFiles`. */
  takeOpenedFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('opened-files:take'),
  onOpenedFiles: (callback: (files: OpenedFile[]) => void) => {
    ipcRenderer.on('opened-files', (_event, files: OpenedFile[]) => callback(files));
  },
});
