// The only bridge between Perch's pages and the main process. Pages get a small
// `window.perch` API limited to Perch's own channels.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const ALLOWED = /^(overlay|engine|panel|confirm):[a-z-]+$/;

function check(channel: string) {
  if (!ALLOWED.test(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
}

const api = {
  send(channel: string, ...args: unknown[]) {
    check(channel);
    ipcRenderer.send(channel, ...args);
  },
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    check(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: string, listener: (data: any) => void): () => void {
    check(channel);
    const wrapped = (_e: IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('perch', api);

export type PerchApi = typeof api;
