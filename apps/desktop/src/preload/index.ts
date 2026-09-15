import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings } from '@eps/core';
import type {
  AppState,
  QrResult,
  SaveResult,
  TestResult,
} from '../main/contract';

/**
 * The renderer's entire capability surface. contextIsolation is on and there is
 * no nodeIntegration — if it is not on this object, the UI cannot do it.
 */
const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),

  onState: (cb: (state: AppState) => void): (() => void) => {
    const listener = (_e: unknown, state: AppState) => cb(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.off('state', listener);
  },

  rotatePhoto: (id: string, delta: number): Promise<void> =>
    ipcRenderer.invoke('photo:rotate', id, delta),

  rejectPhoto: (id: string, rejected: boolean): Promise<void> =>
    ipcRenderer.invoke('photo:reject', id, rejected),

  discardPhoto: (id: string): Promise<void> =>
    ipcRenderer.invoke('photo:discard', id),

  /** The central action. Resolves to the new gallery code, or null if empty. */
  finishGroup: (): Promise<string | null> => ipcRenderer.invoke('gallery:finish'),

  retryGallery: (id: string): Promise<void> =>
    ipcRenderer.invoke('gallery:retry', id),

  getQr: (code: string): Promise<QrResult> => ipcRenderer.invoke('gallery:qr', code),

  printQr: (code: string): Promise<void> => ipcRenderer.invoke('gallery:print', code),

  copyText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:write', text),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open', url),

  chooseFolder: (current?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:folder', current),

  chooseFile: (current?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:file', current),

  saveSettings: (settings: AppSettings): Promise<SaveResult> =>
    ipcRenderer.invoke('settings:save', settings),

  testStorage: (): Promise<TestResult> => ipcRenderer.invoke('settings:test'),

  revealWorkDir: (): Promise<void> => ipcRenderer.invoke('reveal:workdir'),
};

contextBridge.exposeInMainWorld('eps', api);

export type EpsApi = typeof api;
