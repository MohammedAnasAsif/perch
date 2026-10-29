// A small "Allow / Stop" popup shown before the agent does something risky.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { SCHEME } from './windows';
import { onTrusted, v } from './ipcguard';

const SIZE = { width: 380, height: 168 };

let win: BrowserWindow | null = null;
let pending: ((ok: boolean) => void) | null = null;

function finish(ok: boolean) {
  const p = pending;
  pending = null;
  if (win && !win.isDestroyed()) win.hide();
  p?.(ok);
}

// Only the popup itself may answer, and only with true/false.
onTrusted(ipcMain, 'confirm:answer', [v.bool], (ok: boolean) => finish(ok));

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    ...SIZE,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#17191f',
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true); // keep it out of the agent's screenshots
  win.loadURL(`${SCHEME}://app/confirm.html`);
  win.on('close', (e) => {
    // Closing the popup counts as "Stop".
    e.preventDefault();
    finish(false);
  });
  return win;
}

/**
 * Asks the user to approve an action. Resolves true for Allow, false for Stop,
 * closing, or no answer within a minute. `near` is a screen point (DIP).
 */
export function askApproval(text: string, near: { x: number; y: number }, signal: AbortSignal): Promise<boolean> {
  if (pending) finish(false);
  const w = ensureWindow();
  const d = screen.getDisplayNearestPoint(near).workArea;
  let x = Math.round(near.x + 24);
  let y = Math.round(near.y + 24);
  if (x + SIZE.width > d.x + d.width - 8) x = Math.round(near.x - SIZE.width - 24);
  if (y + SIZE.height > d.y + d.height - 8) y = Math.round(near.y - SIZE.height - 24);
  x = Math.max(d.x + 8, x);
  y = Math.max(d.y + 8, y);
  w.setPosition(x, y, false);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => pending === settle && finish(false);
    pending = settle;
    timer = setTimeout(() => pending === settle && finish(false), 60_000);
    signal.addEventListener('abort', onAbort, { once: true });
    const show = () => {
      w.webContents.send('confirm:show', { text });
      w.show();
      w.focus();
    };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show);
    else show();
  });
}

export function destroyConfirm() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
