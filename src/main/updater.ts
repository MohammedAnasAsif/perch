// Auto-updates from GitHub Releases (electron-updater). Checks shortly after
// start and every few hours, downloads in the background, and installs when
// Perch quits, or right away if the user clicks "Restart to update".
import { app } from 'electron';
import type { UpdateStatus } from '../shared/types';

const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatus = { kind: 'idle' };
let onChange: (s: UpdateStatus) => void = () => {};
let updater: any = null;

function set(s: UpdateStatus) {
  status = s;
  onChange(s);
}

export function updateStatus() {
  return status;
}

export function initUpdater(listener: (s: UpdateStatus) => void) {
  onChange = listener;
  if (!app.isPackaged) return; // nothing to update in development
  try {
    // Loaded lazily: it's only needed in the installed app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    updater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[perch] auto-update unavailable', err);
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = {
    info: (...a: unknown[]) => console.log('[update]', ...a),
    warn: (...a: unknown[]) => console.warn('[update]', ...a),
    error: (...a: unknown[]) => console.error('[update]', ...a),
    debug: () => {},
  };
  updater.on('checking-for-update', () => set({ kind: 'checking' }));
  updater.on('update-not-available', () => set({ kind: 'current' }));
  updater.on('update-available', (info: { version: string }) => set({ kind: 'downloading', version: info.version, progress: 0 }));
  updater.on('download-progress', (p: { percent: number }) =>
    set({ kind: 'downloading', version: status.kind === 'downloading' ? status.version : '', progress: p.percent }),
  );
  updater.on('update-downloaded', (info: { version: string }) => set({ kind: 'ready', version: info.version }));
  updater.on('error', (err: Error) => {
    console.error('[perch] update check failed:', err?.message);
    set({ kind: 'error', message: 'Could not check for updates.' });
  });

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(), EVERY_MS);
}

export async function checkForUpdates() {
  if (!updater) {
    set({ kind: app.isPackaged ? 'error' : 'current', ...(app.isPackaged ? { message: 'Updates unavailable.' } : {}) } as UpdateStatus);
    return;
  }
  if (status.kind === 'downloading' || status.kind === 'ready') return;
  try {
    await updater.checkForUpdates();
  } catch {
    /* reported through the 'error' event */
  }
}

/** Quits and installs a downloaded update. */
export function installUpdate() {
  if (updater && status.kind === 'ready') {
    setImmediate(() => updater.quitAndInstall(true, true));
  }
}
