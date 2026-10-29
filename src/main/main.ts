// Perch main process: app lifecycle, tray, IPC and the cursor-following loop.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron';
import { join } from 'node:path';
import { Companion } from './companion';
import { Hotkey, FALLBACK_SHORTCUT } from './hotkey';
import { clearApiKey, getApiKey, getSettings, hasApiKey, setApiKey, updateSettings } from './settings';
import {
  createEngineWindow,
  createPanelWindow,
  isDev,
  Overlays,
  positionPanel,
  registerProtocolHandler,
  registerSchemeEarly,
  SCHEME,
} from './windows';
import type { AppStatus, Settings, SttStatus, TranscriptMsg } from '../shared/types';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('dev.perch.app');
registerSchemeEarly();

const overlays = new Overlays();
let engine: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkey: Hotkey;
let companion: Companion;
let cursorTimer: ReturnType<typeof setInterval> | null = null;
let paused = false;
let panelHiddenAt = 0;

function broadcastStatus(s: AppStatus) {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:status', s);
  tray?.setToolTip(trayTooltip(s));
}

function trayTooltip(s: AppStatus) {
  if (paused) return 'Perch (paused)';
  if (!s.hasApiKey) return 'Perch: add your Claude API key';
  if (s.stt.kind === 'loading') return `Perch: downloading speech model (${Math.round(s.stt.progress)}%)`;
  return `Perch: hold ${comboLabel(getSettings())} and talk`;
}

export function comboLabel(s: Settings) {
  if (!hotkey?.available) return FALLBACK_SHORTCUT.replace(/\+/g, ' + ');
  return s.hotkey
    .split('+')
    .map((k) => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win' })[k])
    .join(' + ');
}

function openPanel() {
  if (!panel || panel.isDestroyed()) {
    panel = createPanelWindow();
    panel.on('hide', () => (panelHiddenAt = Date.now()));
  }
  positionPanel(panel, tray?.getBounds());
  panel.show();
  panel.focus();
  panel.webContents.send('panel:status', companion.status());
}

function togglePanel() {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide();
  // Clicking the tray icon blurs (and hides) the panel first; don't reopen it.
  else if (Date.now() - panelHiddenAt > 300) openPanel();
}

function trayIcon() {
  const img = nativeImage.createFromPath(join(__dirname, 'assets', 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Perch', click: openPanel },
    { label: 'New conversation', click: () => companion.resetConversation() },
    { type: 'separator' },
    {
      label: 'Pause',
      type: 'checkbox',
      checked: paused,
      click: (item) => setPaused(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit Perch', click: () => app.quit() },
  ]);
}

function setPaused(p: boolean) {
  paused = p;
  if (p) {
    companion.interrupt();
    overlays.send('overlay:visible', false);
  } else {
    overlays.send('overlay:visible', true);
  }
  tray?.setContextMenu(buildTrayMenu());
  broadcastStatus(companion.status());
}

function applySettings(s: Settings) {
  hotkey.setCombo(s.hotkey);
  overlays.send('overlay:settings', { showWhenIdle: s.showWhenIdle });
  if (engine && !engine.isDestroyed()) engine.webContents.send('engine:settings', s);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  broadcastStatus(companion.status());
}

function startEngine() {
  engine = createEngineWindow();
  engine.webContents.once('did-finish-load', () => engine?.webContents.send('engine:settings', getSettings()));
  engine.webContents.on('render-process-gone', (_e, details) => {
    console.error('[perch] engine crashed', details.reason);
    setTimeout(startEngine, 1000);
  });
}

function setupIpc() {
  // From the engine (mic, speech recognition, voice).
  ipcMain.on('engine:transcript', (_e, msg: TranscriptMsg) => companion.onTranscript(msg.text, msg.error));
  ipcMain.on('engine:level', (_e, level: number) => overlays.send('overlay:level', level));
  ipcMain.on('engine:stt-status', (_e, s: SttStatus) => companion.setSttStatus(s));
  ipcMain.on('engine:utterance-start', (_e, id: number) => companion.onUtteranceStart(id));
  ipcMain.on('engine:utterance-end', (_e, id: number) => companion.onUtteranceEnd(id));
  ipcMain.on('engine:log', (_e, ...args: unknown[]) => console.log('[engine]', ...args));

  // From the panel.
  ipcMain.handle('panel:get', () => ({
    settings: getSettings(),
    status: companion.status(),
    comboLabel: comboLabel(getSettings()),
  }));
  ipcMain.handle('panel:update-settings', (_e, patch: Partial<Settings>) => {
    const s = updateSettings(patch);
    applySettings(s);
    return { settings: s, comboLabel: comboLabel(s) };
  });
  ipcMain.handle('panel:set-key', (_e, key: string) => {
    try {
      setApiKey(String(key ?? ''));
      broadcastStatus(companion.status());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('panel:clear-key', () => {
    clearApiKey();
    broadcastStatus(companion.status());
    return { ok: true };
  });
  ipcMain.on('panel:ask', (_e, text: string) => {
    panel?.hide();
    companion.askTyped(String(text ?? ''));
  });
  ipcMain.on('panel:hide', () => panel?.hide());
  ipcMain.on('panel:new-conversation', () => companion.resetConversation());
  ipcMain.on('panel:test-voice', (_e, opts: { voiceName: string; rate: number }) => {
    engine?.webContents.send('engine:speak', {
      id: -1,
      text: "Hi, I'm Perch. Hold the keys and ask me anything about your screen.",
      ...opts,
    });
  });
  ipcMain.on('panel:open-url', (_e, url: string) => {
    if (/^https:\/\/(console\.anthropic\.com|platform\.claude\.com|github\.com)\//.test(url)) {
      void shell.openExternal(url);
    }
  });
  ipcMain.on('panel:quit', () => app.quit());
}

function startCursorLoop() {
  cursorTimer = setInterval(() => {
    if (!paused) companion.tickCursor();
  }, 16);
}

app.whenReady().then(() => {
  registerProtocolHandler();

  // Only our own pages may use the microphone, and nothing else.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = wc.getURL().startsWith(`${SCHEME}://app/`);
    cb(ok && (permission === 'media' || permission === 'speaker-selection' as any));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return !!wc?.getURL().startsWith(`${SCHEME}://app/`) && permission === 'media';
  });
  // Our pages never navigate away or open windows.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (ev, url) => {
      if (!url.startsWith(`${SCHEME}://app/`)) ev.preventDefault();
    });
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  const settings = getSettings();

  companion = new Companion({
    overlays,
    engine: () => engine,
    settings: getSettings,
    getKey: getApiKey,
    hasKey: hasApiKey,
    onStatus: broadcastStatus,
    openPanel,
    hotkeyAvailable: () => hotkey?.available ?? false,
    version: app.getVersion(),
  });

  hotkey = new Hotkey(settings.hotkey, {
    onStart: () => !paused && companion.startListening(),
    onStop: () => !paused && companion.stopListening(),
    onCancel: () => companion.cancelListening(),
    onEscape: () => {
      if (companion.currentState() !== 'idle') companion.interrupt();
      hotkey.resetToggle();
    },
  });
  hotkey.start();

  overlays.sync();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(ev as any, () => {
      overlays.sync();
      companion.forceCursorRefresh();
    });
  }

  startEngine();
  setupIpc();
  startCursorLoop();

  tray = new Tray(trayIcon());
  tray.setToolTip('Perch');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', togglePanel);

  applySettings(settings);

  // First run: help the user add their key.
  if (!hasApiKey()) setTimeout(openPanel, 800);
  if (isDev()) console.log('[perch] running in development mode');
});

app.on('second-instance', openPanel);

// Perch lives in the tray; closing windows shouldn't quit it.
app.on('window-all-closed', () => {
  /* keep running */
});

app.on('before-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  hotkey?.stop();
  overlays.destroyAll();
});
