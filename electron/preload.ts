import { contextBridge, ipcRenderer } from 'electron';

export interface RendererErrorPayload {
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

contextBridge.exposeInMainWorld('myAstroDiagnostics', {
  logError: (payload: RendererErrorPayload) => ipcRenderer.invoke('diagnostics:log-error', payload),
  getLogsDir: () => ipcRenderer.invoke('diagnostics:get-logs-dir'),
  getLogsPathHint: () => ipcRenderer.invoke('diagnostics:get-logs-path-hint'),
  openLogsDir: () => ipcRenderer.invoke('diagnostics:open-logs-dir'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  getLocation: () => ipcRenderer.invoke('get-location'),
});
