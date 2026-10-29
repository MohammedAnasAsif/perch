// Settings and status panel, opened from the tray icon.
import { perch } from './bridge';
import { NATURAL_VOICES, type AppStatus, type ProviderId, type Settings } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

interface ModelOption {
  id: string;
  label: string;
}
interface OllamaStatus {
  running: boolean;
  models: string[];
  error?: string;
}

let settings: Settings;
let status: AppStatus | null = null;
let comboLabel = 'Ctrl + Alt';
let geminiModels: ModelOption[] = [];
let ollamaSuggested: ModelOption[] = [];
let ollama: OllamaStatus | null = null;

// ------------------------------------------------------------ status

const STATE_TEXT: Record<AppStatus['state'], string> = {
  idle: '',
  listening: 'Listening…',
  transcribing: 'Working out what you said…',
  thinking: 'Thinking…',
  speaking: 'Talking',
  working: 'Agent is working…',
  error: '',
};

function renderStatus(s: AppStatus) {
  status = s;
  const el = $('status');
  let text = s.state === 'working' && s.agentStep ? `Agent: ${s.agentStep}` : STATE_TEXT[s.state];
  if (!text) {
    if (!s.aiReady) text = 'Choose your AI to get started';
    else if (s.stt.kind === 'loading') text = `Getting speech recognition ready (${Math.round(s.stt.progress)}%)`;
    else if (s.state === 'error' && s.error) text = s.error;
    else text = `Ready. Hold ${comboLabel} and talk`;
  }
  el.textContent = text;
  el.classList.toggle('busy', s.state !== 'idle' && s.state !== 'error');

  $('onboard').hidden = s.aiReady;

  for (const p of ['claude', 'gemini'] as const) {
    const has = s.keys[p];
    $(`${p}-key-state`).textContent = has ? 'Saved securely on this PC' : 'Not set';
    const change = document.querySelector<HTMLElement>(`.key-change[data-provider="${p}"]`)!;
    change.textContent = has ? 'Change' : 'Add';
    document.querySelector<HTMLElement>(`.key-remove[data-provider="${p}"]`)!.hidden = !has;
  }

  const sttState = $('stt-state');
  const bar = $('stt-progress');
  if (s.stt.kind === 'loading') {
    sttState.textContent = `Downloading… ${Math.round(s.stt.progress)}%`;
    bar.hidden = false;
    (bar.firstElementChild as HTMLElement).style.width = `${s.stt.progress}%`;
  } else {
    bar.hidden = true;
    sttState.textContent =
      s.stt.kind === 'ready' ? 'Ready, runs on this PC' : s.stt.kind === 'error' ? s.stt.message : 'Runs on this PC';
  }

  // Natural voice status
  const ttsState = $('tts-state');
  const ttsBar = $('tts-progress');
  if (s.tts.kind === 'loading') {
    ttsState.textContent = `Downloading natural voice… ${Math.round(s.tts.progress)}%`;
    ttsBar.hidden = settings?.voiceEngine !== 'natural';
    (ttsBar.firstElementChild as HTMLElement).style.width = `${s.tts.progress}%`;
  } else {
    ttsBar.hidden = true;
    ttsState.textContent =
      settings?.voiceEngine === 'windows'
        ? 'Built-in Windows voices'
        : s.tts.kind === 'ready'
          ? 'Natural voice ready, runs on this PC'
          : s.tts.kind === 'error'
            ? s.tts.message
            : 'Natural voice runs on this PC';
  }

  const hk = $<HTMLSelectElement>('hotkey');
  hk.disabled = !s.hotkeyAvailable;
  $('hotkey-note').textContent = s.hotkeyAvailable
    ? 'Hold, speak, release'
    : `Keyboard hook unavailable. Press ${comboLabel} to start and again to stop`;

  $('last').hidden = !s.lastQuestion;
  $('last-q').textContent = s.lastQuestion;
  $('last-a').textContent = s.lastAnswer || (s.state === 'thinking' || s.state === 'working' ? '…' : '');
  const u = s.update;
  const card = $('update');
  card.hidden = u.kind !== 'ready';
  if (u.kind === 'ready') $('update-text').textContent = `Perch ${u.version} is ready to install.`;
  $('version').textContent =
    u.kind === 'checking'
      ? 'Checking for updates…'
      : u.kind === 'downloading'
        ? `Downloading ${u.version} (${Math.round(u.progress)}%)`
        : u.kind === 'current'
          ? `v${s.version} · up to date`
          : `v${s.version}`;
}

// ------------------------------------------------------------ settings

function setOptions(sel: HTMLSelectElement, opts: ModelOption[], value: string) {
  sel.length = 0;
  for (const o of opts) sel.add(new Option(o.label, o.id));
  if (value && !opts.some((o) => o.id === value)) sel.add(new Option(value, value)); // custom/hand-edited
  sel.value = value;
}

function renderOllama() {
  const state = $('ollama-state');
  const sel = $<HTMLSelectElement>('ollama-model');
  const installed = ollama?.models ?? [];
  if (!ollama) state.textContent = 'Checking…';
  else if (!ollama.running) state.textContent = 'Not running. Install or start Ollama';
  else state.textContent = installed.length ? `Running · ${installed.length} model${installed.length > 1 ? 's' : ''} installed` : 'Running · no models yet';

  const opts: ModelOption[] = [
    ...installed.map((m) => ({ id: m, label: `${m} (installed)` })),
    ...ollamaSuggested.filter((s) => !installed.includes(s.id)).map((s) => ({ id: s.id, label: `${s.label}, not installed` })),
  ];
  setOptions(sel, opts, settings.ollamaModel);
  const ready = installed.includes(settings.ollamaModel) || installed.includes(`${settings.ollamaModel}:latest`);
  $('ollama-model-note').textContent = ollama?.running ? (ready ? 'Ready' : 'Not installed yet') : '';
  $('ollama-cmd').textContent = `ollama pull ${settings.ollamaModel}`;
  $('ollama-help').hidden = !!(ollama?.running && ready);
}

async function refreshOllama() {
  ollama = null;
  renderOllama();
  ollama = (await perch.invoke<OllamaStatus>('panel:ollama-status')) ?? { running: false, models: [] };
  renderOllama();
}

function renderSettings(s: Settings) {
  settings = s;
  for (const b of $$('#provider button')) b.setAttribute('aria-checked', String(b.dataset.value === s.provider));
  for (const pane of $$('[data-pane]')) pane.hidden = pane.dataset.pane !== s.provider;

  const cm = $<HTMLSelectElement>('claude-model');
  cm.value = s.claudeModel;
  if (cm.value !== s.claudeModel) {
    cm.add(new Option(s.claudeModel, s.claudeModel));
    cm.value = s.claudeModel;
  }
  for (const b of $$('#effort button')) b.setAttribute('aria-checked', String(b.dataset.value === s.effort));
  setOptions($<HTMLSelectElement>('gemini-model'), geminiModels, s.geminiModel);
  if (s.provider === 'ollama') renderOllama();

  $<HTMLInputElement>('agent-control').checked = s.agentControl;
  $<HTMLSelectElement>('agent-confirm').value = s.agentConfirm;
  $<HTMLSelectElement>('agent-confirm').disabled = !s.agentControl;
  const note = $('agent-note');
  note.hidden = s.provider === 'claude' || !s.agentControl;
  note.textContent =
    s.provider === 'gemini'
      ? 'Tip: agent tasks take many steps, so Gemini’s free daily limit can run out quickly. Research-only tasks use fewer.'
      : 'Tip: local models can be slow and less precise at clicking. Research and writing tasks work best.';

  $<HTMLSelectElement>('hotkey').value = s.hotkey;
  $<HTMLSelectElement>('stt').value = s.whisperModel;
  $<HTMLInputElement>('speak').checked = s.speakReplies;
  $<HTMLInputElement>('wake').checked = s.wakeWord;
  $<HTMLInputElement>('memory-on').checked = s.memoryEnabled;
  $<HTMLInputElement>('rate').value = String(s.speechRate);
  $('rate-value').textContent = `${s.speechRate.toFixed(2).replace(/0$/, '')}×`;
  $<HTMLInputElement>('idle').checked = s.showWhenIdle;
  $<HTMLInputElement>('login').checked = s.launchAtLogin;
  $<HTMLInputElement>('privacy-guard').checked = s.privacyGuard;
  const pa = $<HTMLInputElement>('private-apps');
  if (document.activeElement !== pa) pa.value = s.privateApps;
  pa.disabled = !s.privacyGuard;
  $<HTMLSelectElement>('voice').value = s.voiceName;
  $<HTMLSelectElement>('voice').disabled = !s.speakReplies;
  for (const b of $$('#voice-engine button')) b.setAttribute('aria-checked', String(b.dataset.value === s.voiceEngine));
  const nv = $<HTMLSelectElement>('natural-voice');
  if (!nv.length) for (const v of NATURAL_VOICES) nv.add(new Option(v.label, v.id));
  nv.value = s.naturalVoice;
  nv.hidden = s.voiceEngine !== 'natural';
  $<HTMLSelectElement>('voice').hidden = s.voiceEngine !== 'windows';
  nv.disabled = !s.speakReplies;
  if (status) renderStatus(status);
  $<HTMLInputElement>('rate').disabled = !s.speakReplies;
}

async function update(patch: Partial<Settings>) {
  const r = await perch.invoke<{ settings: Settings; comboLabel: string }>('panel:update-settings', patch);
  if (!r) return;
  comboLabel = r.comboLabel;
  renderSettings(r.settings);
}

async function chooseProvider(p: ProviderId) {
  await update({ provider: p });
  if (p === 'ollama') void refreshOllama();
  if (p !== 'ollama' && !status?.keys[p]) openKeyForm(p);
}

function fillVoices() {
  const sel = $<HTMLSelectElement>('voice');
  const voices = speechSynthesis
    .getVoices()
    .slice()
    .sort((a, b) => Number(b.lang.startsWith('en')) - Number(a.lang.startsWith('en')) || a.name.localeCompare(b.name));
  sel.length = 1;
  for (const v of voices) {
    const name = v.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '');
    sel.add(new Option(`${name} (${v.lang})`, v.name));
  }
  if (settings) sel.value = settings.voiceName;
}

// ------------------------------------------------------------ keys

function keyForm(p: 'claude' | 'gemini') {
  return document.querySelector<HTMLFormElement>(`.key-form[data-provider="${p}"]`)!;
}

function openKeyForm(p: 'claude' | 'gemini') {
  const f = keyForm(p);
  f.hidden = false;
  f.querySelector('input')!.focus();
}

for (const f of $$<HTMLFormElement>('.key-form')) {
  const p = f.dataset.provider as 'claude' | 'gemini';
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = f.querySelector('input')!;
    const r = await perch.invoke<{ ok: boolean; error?: string }>('panel:set-key', p, input.value);
    if (r?.ok) {
      input.value = '';
      f.hidden = true;
    } else {
      alert(r?.error ?? 'Could not save the key.');
    }
  });
}
for (const b of $$('.key-change')) {
  b.addEventListener('click', () => {
    const f = keyForm(b.dataset.provider as 'claude' | 'gemini');
    if (f.hidden) openKeyForm(b.dataset.provider as 'claude' | 'gemini');
    else f.hidden = true;
  });
}
for (const b of $$('.key-remove')) {
  b.addEventListener('click', () => {
    if (confirm('Remove the saved key from this PC?')) void perch.invoke('panel:clear-key', b.dataset.provider);
  });
}

// ------------------------------------------------------------ events

$('close').addEventListener('click', () => perch.send('panel:hide'));
window.addEventListener('keydown', (e) => e.key === 'Escape' && perch.send('panel:hide'));

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('ask');
  if (!input.value.trim()) return;
  perch.send('panel:ask', input.value);
  input.value = '';
});

for (const a of $$<HTMLAnchorElement>('a[data-url]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    perch.send('panel:open-url', a.dataset.url);
  });
}

for (const b of $$('.choice')) b.addEventListener('click', () => chooseProvider(b.dataset.provider as ProviderId));
$('provider').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.value;
  if (v) void chooseProvider(v as ProviderId);
});
$('claude-model').addEventListener('change', (e) => update({ claudeModel: (e.target as HTMLSelectElement).value }));
$('gemini-model').addEventListener('change', (e) => update({ geminiModel: (e.target as HTMLSelectElement).value }));
$('ollama-model').addEventListener('change', (e) => update({ ollamaModel: (e.target as HTMLSelectElement).value }));
$('ollama-recheck').addEventListener('click', () => refreshOllama());
$('copy-cmd').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('ollama-cmd').textContent ?? '');
    $('copy-cmd').textContent = 'Copied';
    setTimeout(() => ($('copy-cmd').textContent = 'Copy'), 1500);
  } catch {
    /* clipboard unavailable */
  }
});
$('effort').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.value;
  if (v) void update({ effort: v as Settings['effort'] });
});
$('agent-control').addEventListener('change', (e) => update({ agentControl: (e.target as HTMLInputElement).checked }));
$('agent-confirm').addEventListener('change', (e) =>
  update({ agentConfirm: (e.target as HTMLSelectElement).value as Settings['agentConfirm'] }),
);
$('hotkey').addEventListener('change', (e) => update({ hotkey: (e.target as HTMLSelectElement).value as Settings['hotkey'] }));
$('stt').addEventListener('change', (e) =>
  update({ whisperModel: (e.target as HTMLSelectElement).value as Settings['whisperModel'] }),
);
$('speak').addEventListener('change', (e) => update({ speakReplies: (e.target as HTMLInputElement).checked }));
$('wake').addEventListener('change', (e) => update({ wakeWord: (e.target as HTMLInputElement).checked }));
$('voice').addEventListener('change', (e) => update({ voiceName: (e.target as HTMLSelectElement).value }));
$('natural-voice').addEventListener('change', (e) => update({ naturalVoice: (e.target as HTMLSelectElement).value }));
$('voice-engine').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.value;
  if (v) void update({ voiceEngine: v as Settings['voiceEngine'] });
});
$('rate').addEventListener('input', (e) => {
  $('rate-value').textContent = `${Number((e.target as HTMLInputElement).value).toFixed(2).replace(/0$/, '')}×`;
});
$('rate').addEventListener('change', (e) => update({ speechRate: Number((e.target as HTMLInputElement).value) }));
$('test-voice').addEventListener('click', () =>
  perch.send('panel:test-voice', { voiceName: settings.voiceName, rate: settings.speechRate }),
);
$('idle').addEventListener('change', (e) => update({ showWhenIdle: (e.target as HTMLInputElement).checked }));
$('login').addEventListener('change', (e) => update({ launchAtLogin: (e.target as HTMLInputElement).checked }));
$('privacy-guard').addEventListener('change', (e) => update({ privacyGuard: (e.target as HTMLInputElement).checked }));
$('private-apps').addEventListener('change', (e) => update({ privateApps: (e.target as HTMLInputElement).value.slice(0, 2000) }));
$('new-convo').addEventListener('click', () => perch.send('panel:new-conversation'));
$('quit').addEventListener('click', () => perch.send('panel:quit'));
$('version').addEventListener('click', () => perch.send('panel:check-updates'));
$('install-update').addEventListener('click', () => perch.send('panel:install-update'));

perch.on('panel:status', (s: AppStatus) => renderStatus(s));

// ------------------------------------------------------------ memory and reminders

interface Notes {
  memories: { id: string; text: string }[];
  reminders: { id: string; due: string; text: string }[];
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

function renderList(el: HTMLElement, items: { id: string; text: string; meta?: string }[], empty: string, onDelete: (id: string) => void) {
  el.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = empty;
    el.append(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = it.text;
    li.append(span);
    if (it.meta) {
      const small = document.createElement('small');
      small.textContent = it.meta;
      li.append(small);
    }
    const x = document.createElement('button');
    x.className = 'x';
    x.title = 'Delete';
    x.setAttribute('aria-label', `Delete "${it.text}"`);
    x.textContent = '×';
    x.addEventListener('click', () => onDelete(it.id));
    li.append(x);
    el.append(li);
  }
}

function renderNotes(n: Notes) {
  renderList($('memory-list'), n.memories, 'Nothing yet. Tell Perch about yourself, or say “remember that…”.', (id) =>
    perch.send('panel:memory-delete', id),
  );
  $('memory-actions').hidden = !n.memories.length;
  renderList(
    $('reminder-list'),
    n.reminders.map((r) => ({ id: r.id, text: r.text, meta: whenLabel(r.due) })),
    'No upcoming reminders.',
    (id) => perch.send('panel:reminder-delete', id),
  );
}

perch.on('panel:notes', (n: Notes) => renderNotes(n));
$('memory-on').addEventListener('change', (e) => update({ memoryEnabled: (e.target as HTMLInputElement).checked }));
$('memory-clear').addEventListener('click', () => {
  if (confirm('Forget everything Perch remembers about you?')) perch.send('panel:memory-clear');
});
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    const n = await perch.invoke<Notes>('panel:notes-get');
    if (n) renderNotes(n);
  }
});
// Re-check Ollama whenever the panel is shown again.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && settings?.provider === 'ollama') void refreshOllama();
});

// ------------------------------------------------------------ init

speechSynthesis.onvoiceschanged = fillVoices;
(async () => {
  const init = await perch.invoke<{
    settings: Settings;
    status: AppStatus;
    comboLabel: string;
    geminiModels: ModelOption[];
    ollamaSuggested: ModelOption[];
  }>('panel:get');
  if (!init) return demo();
  comboLabel = init.comboLabel;
  geminiModels = init.geminiModels;
  ollamaSuggested = init.ollamaSuggested;
  renderSettings(init.settings);
  renderStatus(init.status);
  fillVoices();
  const n = await perch.invoke<Notes>('panel:notes-get');
  if (n) renderNotes(n);
  if (init.settings.provider === 'ollama') void refreshOllama();
})();

/** Design preview in a plain browser: panel.html?demo[&provider=…][&ready] */
async function demo() {
  const q = new URLSearchParams(location.search);
  if (!q.has('demo')) return;
  const { DEFAULT_SETTINGS } = await import('../shared/types');
  geminiModels = [
    { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (higher free limits)' },
  ];
  ollamaSuggested = [
    { id: 'qwen3-vl:8b', label: 'Qwen3-VL 8B (6.2 GB, needs ~16 GB RAM)' },
    { id: 'qwen3-vl:4b', label: 'Qwen3-VL 4B (3.3 GB, for 8 GB RAM)' },
  ];
  const provider = (q.get('provider') as ProviderId) ?? 'gemini';
  renderSettings({ ...DEFAULT_SETTINGS, provider });
  if (provider === 'ollama') {
    ollama = { running: true, models: ['llama3.2:3b'] };
    renderOllama();
  }
  const soon = new Date(Date.now() + 90 * 60_000).toISOString();
  renderNotes({
    memories: [
      { id: '1', text: "The user's name is Anas" },
      { id: '2', text: 'Prefers short answers' },
    ],
    reminders: [{ id: 'r', due: soon, text: 'Send the report to Priya' }],
  });
  renderStatus({
    state: q.has('working') ? 'working' : 'idle',
    agentStep: 'Reading reviews on two sites',
    stt: { kind: 'ready' },
    tts: { kind: 'loading', progress: 64 },
    update: { kind: 'ready', version: '0.3.1' },
    provider,
    keys: { claude: false, gemini: q.has('ready') },
    aiReady: q.has('ready'),
    hotkeyAvailable: true,
    lastQuestion: q.has('ready') ? 'Agent, compare three budget laptops and write it up' : '',
    lastAnswer: q.has('ready') ? 'Done. I saved a comparison of three laptops to your Documents and opened it.' : '',
    error: '',
    version: '0.2.0',
  });
}
