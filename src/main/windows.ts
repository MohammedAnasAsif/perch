// Creates and manages Perch's windows:
//  - one transparent, click-through overlay per display (the buddy lives here)
//  - a hidden "engine" window for the microphone, speech recognition and speech
//  - the settings panel opened from the tray
import { BrowserWindow, protocol, net, screen, app, nativeTheme, type Display, type Rectangle } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEME = 'perch';
const RENDERER_DIR = join(__dirname, 'renderer');
const PRELOAD = join(__dirname, 'preload.js');
const page = (name: string) => `${SCHEME}://app/${name}`;

/** Must run before app 'ready'. */
export function registerSchemeEarly() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

/**
 * Serves the renderer files. Pages are cross-origin isolated (COOP/COEP) so the
 * speech model can use multi-threaded WebAssembly.
 */
export function registerProtocolHandler() {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = normalize(join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!res.ok) return new Response('Not found', { status: 404 });
    const ext = file.slice(file.lastIndexOf('.'));
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  });
}

const webPrefs = (extra: Electron.WebPreferences = {}): Electron.WebPreferences => ({
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  ...extra,
});

// ---------------------------------------------------------------- overlays

export class Overlays {
  private byDisplay = new Map<number, BrowserWindow>();

  sync() {
    const displays = screen.getAllDisplays();
    const ids = new Set(displays.map((d) => d.id));
    for (const [id, win] of this.byDisplay) {
      if (!ids.has(id) || win.isDestroyed()) {
        if (!win.isDestroyed()) win.destroy();
        this.byDisplay.delete(id);
      }
    }
    for (const d of displays) {
      const existing = this.byDisplay.get(d.id);
      if (existing) existing.setBounds(overlayBounds(d));
      else this.byDisplay.set(d.id, createOverlay(d));
    }
  }

  get(displayId: number) {
    const w = this.byDisplay.get(displayId);
    return w && !w.isDestroyed() ? w : undefined;
  }

  entries(): [Display, BrowserWindow][] {
    const out: [Display, BrowserWindow][] = [];
    for (const d of screen.getAllDisplays()) {
      const w = this.get(d.id);
      if (w) out.push([d, w]);
    }
    return out;
  }

  send(channel: string, data?: unknown) {
    for (const [, w] of this.entries()) w.webContents.send(channel, data);
  }

  sendTo(displayId: number, channel: string, data?: unknown) {
    this.get(displayId)?.webContents.send(channel, data);
  }

  destroyAll() {
    for (const [, w] of this.byDisplay) if (!w.isDestroyed()) w.destroy();
    this.byDisplay.clear();
  }
}

function overlayBounds(d: Display): Rectangle {
  // One pixel shorter than the display so Windows doesn't treat it as a
  // full-screen app (which can hide the taskbar or pause notifications).
  return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height - 1 };
}

function createOverlay(d: Display): BrowserWindow {
  const win = new BrowserWindow({
    ...overlayBounds(d),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: webPrefs({ backgroundThrottling: false }),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true);
  // Keep the buddy out of its own screenshots (Windows 10 2004+).
  win.setContentProtection(true);
  win.loadURL(page(`overlay.html?display=${d.id}`));
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

// ---------------------------------------------------------------- engine

export function createEngineWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    skipTaskbar: true,
    webPreferences: webPrefs({ backgroundThrottling: false }),
  });
  win.loadURL(page('engine.html'));
  return win;
}

// ---------------------------------------------------------------- panel

export const PANEL_SIZE = { width: 380, height: 600 };

export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2024' : '#f6f7f9',
    roundedCorners: true,
    webPreferences: webPrefs(),
  });
  win.loadURL(page('panel.html'));
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) win.hide();
  });
  return win;
}

/** Places the panel just above the tray icon (or bottom-right of the screen). */
export function positionPanel(win: BrowserWindow, trayBounds?: Rectangle) {
  const anchor = trayBounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const display = trayBounds ? screen.getDisplayMatching(trayBounds) : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const { width, height } = PANEL_SIZE;
  let x = trayBounds ? Math.round(anchor.x + anchor.width / 2 - width / 2) : wa.x + wa.width - width - 12;
  let y = wa.y + wa.height - height - 12;
  // Taskbar at the top?
  if (trayBounds && anchor.y < wa.y + 10) y = wa.y + 12;
  x = Math.max(wa.x + 12, Math.min(x, wa.x + wa.width - width - 12));
  win.setPosition(x, y, false);
}

export function isDev() {
  return process.argv.includes('--dev') || !app.isPackaged;
}
