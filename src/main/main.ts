// Perch main process: app lifecycle, tray, IPC and the cursor-following loop.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray } from 'electron';
import { join } from 'node:path';
import { Companion } from './companion';
import { Hotkey, FALLBACK_SHORTCUT } from './hotkey';
import { clearApiKey, getSettings, hasApiKey, setApiKey, updateSettings, type KeyProvider } from './settings';
import { aiReady } from './ai';
import { GEMINI_MODELS } from './ai/gemini';
import { OLLAMA_SUGGESTED, ollamaStatus } from './ai/ollama';
import { WindowsInput } from './agent/input';
import { askApproval, destroyConfirm } from './confirm';
import { installFileLog, logDir } from './log';
import { handleTrusted, onTrusted, v } from './ipcguard';
import { maybeRunTestScript } from './testhook';
import { providers } from './ai';
import { parsePrivateList, privateReason } from '../shared/privacy';
import { checkForUpdates, initUpdater, installUpdate, updateStatus } from './updater';
import { memories } from './store';
import { deleteReminder, startReminders, stopReminders, upcomingReminders } from './reminders';
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
installFileLog();
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
const input = new WindowsInput();

function broadcastStatus(s: AppStatus) {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:status', s);
  tray?.setToolTip(trayTooltip(s));
}

function trayTooltip(s: AppStatus) {
  if (paused) return 'Perch (paused)';
  if (!s.aiReady) return 'Perch: choose your AI in settings';
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
    { label: 'Open log folder', click: () => void shell.openPath(logDir()) },
    updateStatus().kind === 'ready'
      ? { label: 'Restart to update', click: () => installUpdate() }
      : { label: 'Check for updates', click: () => void checkForUpdates() },
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

function notes() {
  return {
    memories: memories.all().map((m) => ({ id: m.id, text: m.text })),
    reminders: upcomingReminders().map((r) => ({ id: r.id, due: r.due, text: r.text })),
  };
}

function sendNotes() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:notes', notes());
}

function setupIpc() {
  // Every listener checks that the message came from the right Perch page and
  // that its arguments have the expected shape (see ipcguard.ts).
  const statusShape = (x: unknown) =>
    v.object(x) && v.oneOf('idle', 'loading', 'ready', 'error')((x as SttStatus).kind);
  const on = (ch: string, checks: ((x: unknown) => boolean)[], fn: (...a: any[]) => void) => onTrusted(ipcMain, ch, checks, fn);
  const handle = (ch: string, checks: ((x: unknown) => boolean)[], fn: (...a: any[]) => unknown) =>
    handleTrusted(ipcMain, ch, checks, fn);

  // From the engine (mic, speech recognition, voice).
  on(
    'engine:transcript',
    [(m) => v.object(m) && v.str(5000)((m as TranscriptMsg).text) && ((m as TranscriptMsg).error === undefined || v.str(500)((m as TranscriptMsg).error))],
    (msg: TranscriptMsg) => companion.onTranscript(msg.text, msg.error),
  );
  on('engine:level', [v.num(0, 1)], (level: number) => overlays.send('overlay:level', level));
  on('engine:wake', [(m) => v.object(m) && v.str(2000)((m as any).text) && v.bool((m as any).command)], (m: { text: string; command: boolean }) => {
    if (paused) return;
    console.log('[perch] wake word', m.command ? `with request: "${m.text}"` : '(listening for request)');
    companion.onWake(m.text, m.command);
  });
  on('engine:wake-timeout', [], () => companion.onWakeTimeout());
  on('engine:stt-status', [statusShape], (s: SttStatus) => companion.setSttStatus(s));
  on('engine:tts-status', [statusShape], (s: SttStatus) => {
    if (s.kind !== 'loading') console.log('[perch] natural voice:', JSON.stringify(s));
    companion.setTtsStatus(s);
  });
  on('engine:utterance-start', [v.int(-1, 1e9)], (id: number) => companion.onUtteranceStart(id));
  on('engine:utterance-end', [v.int(-1, 1e9)], (id: number) => companion.onUtteranceEnd(id));
  on('engine:log', [], (...args: unknown[]) => console.log('[engine]', ...args.map((a) => String(a).slice(0, 1000)).slice(0, 10)));

  // From the panel.
  handle('panel:get', [], () => ({
    settings: getSettings(),
    status: companion.status(),
    comboLabel: comboLabel(getSettings()),
    geminiModels: GEMINI_MODELS,
    ollamaSuggested: OLLAMA_SUGGESTED,
  }));
  handle('panel:ollama-status', [], () => ollamaStatus(getSettings().ollamaUrl));
  handle('panel:update-settings', [v.object], (patch: Partial<Settings>) => {
    const s = updateSettings(patch);
    applySettings(s);
    return { settings: s, comboLabel: comboLabel(s) };
  });
  handle('panel:set-key', [v.oneOf('claude', 'gemini'), v.str(500)], (provider: KeyProvider, key: string) => {
    try {
      setApiKey(provider, key);
      broadcastStatus(companion.status());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  handle('panel:clear-key', [v.oneOf('claude', 'gemini')], (provider: KeyProvider) => {
    clearApiKey(provider);
    broadcastStatus(companion.status());
    return { ok: true };
  });
  on('panel:ask', [v.str(4000)], (text: string) => {
    panel?.hide();
    companion.askTyped(text);
  });
  on('panel:hide', [], () => panel?.hide());
  on('panel:new-conversation', [], () => companion.resetConversation());
  on('panel:test-voice', [(o) => v.object(o) && v.str(200)((o as any).voiceName) && v.num(0.5, 2)((o as any).rate)], (opts: { voiceName: string; rate: number }) => {
    engine?.webContents.send('engine:speak', {
      id: -1,
      text: "Hi, I'm Perch. Hold the keys and ask me anything about your screen.",
      voiceName: opts.voiceName,
      rate: opts.rate,
    });
  });
  on('panel:open-url', [v.str(500)], (url: string) => {
    if (/^https:\/\/(console\.anthropic\.com|platform\.claude\.com|github\.com|aistudio\.google\.com|ollama\.com)\//.test(url)) {
      void shell.openExternal(url);
    }
  });
  on('panel:quit', [], () => app.quit());
  handle('panel:notes-get', [], () => notes());
  on('panel:memory-delete', [v.uuid], (id: string) => {
    memories.remove(id);
    sendNotes();
  });
  on('panel:memory-clear', [], () => {
    memories.clear();
    sendNotes();
  });
  on('panel:reminder-delete', [v.uuid], (id: string) => {
    deleteReminder(id);
    sendNotes();
  });
  on('panel:check-updates', [], () => void checkForUpdates());
  on('panel:install-update', [], () => installUpdate());
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
    aiReady: () => aiReady(),
    keys: () => ({ claude: hasApiKey('claude'), gemini: hasApiKey('gemini') }),
    input,
    approve: askApproval,
    suppressHotkeys: (ms) => hotkey.suppress(ms),
    privacyCheck: async () => {
      const s = getSettings();
      if (!s.privacyGuard) return null;
      const w = await input.foregroundWindow(); // fails (=> not private) off Windows
      return privateReason(w, parsePrivateList(s.privateApps));
    },
    onNotesChanged: () => sendNotes(),
    onStatus: broadcastStatus,
    updateStatus,
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

  startReminders(
    (r, missedBy) => {
      const late = missedBy > 2 * 60_000;
      const when = new Date(r.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      console.log('[perch] reminder due:', r.text);
      if (Notification.isSupported()) {
        new Notification({
          title: 'Perch reminder',
          body: late ? `${r.text} (was due at ${when})` : r.text,
          icon: join(__dirname, 'assets', 'icon.png'),
        }).show();
      }
      companion.announce(late ? `Reminder from ${when}: ${r.text}` : `Reminder: ${r.text}`);
    },
    () => sendNotes(),
  );

  initUpdater((u) => {
    if (u.kind === 'ready') console.log('[perch] update downloaded:', u.version);
    tray?.setContextMenu(buildTrayMenu());
    companion.refreshStatus();
  });

  // First run: help the user add their key.
  if (!aiReady()) setTimeout(openPanel, 800);

  // Development builds only: lets the automated tests drive the real app.
  maybeRunTestScript(() => ({
    companion,
    providers,
    input,
    overlays,
    hotkey,
    getSettings,
    updateSettings,
    applySettings,
    memories,
    upcomingReminders,
    openPanel,
    panel: () => panel,
    engine: () => engine,
    escape: () => {
      if (companion.currentState() !== 'idle') companion.interrupt();
    },
  }));
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
  stopReminders();
  input.dispose();
  destroyConfirm();
  overlays.destroyAll();
});
