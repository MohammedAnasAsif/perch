// Settings and status panel, opened from the tray icon.
import { perch } from './bridge';
import type { AppStatus, Settings } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;
let comboLabel = 'Ctrl + Alt';

// ------------------------------------------------------------ status

const STATE_TEXT: Record<AppStatus['state'], string> = {
  idle: '',
  listening: 'Listening…',
  transcribing: 'Working out what you said…',
  thinking: 'Thinking…',
  speaking: 'Talking',
  error: '',
};

function renderStatus(s: AppStatus) {
  const status = $('status');
  let text = STATE_TEXT[s.state];
  if (!text) {
    if (!s.hasApiKey) text = 'Add your API key to get started';
    else if (s.stt.kind === 'loading') text = `Getting speech recognition ready (${Math.round(s.stt.progress)}%)`;
    else if (s.state === 'error' && s.error) text = s.error;
    else text = `Ready. Hold ${comboLabel} and talk`;
  }
  status.textContent = text;
  status.classList.toggle('busy', s.state !== 'idle' && s.state !== 'error');

  $('onboard').hidden = s.hasApiKey;
  $('key-state').textContent = s.hasApiKey ? 'Saved securely on this PC' : 'Not set';
  $('key-change').textContent = s.hasApiKey ? 'Change' : 'Add';
  $('key-remove').hidden = !s.hasApiKey;

  // Speech model status
  const sttState = $('stt-state');
  const bar = $('stt-progress');
  if (s.stt.kind === 'loading') {
    sttState.textContent = `Downloading… ${Math.round(s.stt.progress)}%`;
    bar.hidden = false;
    (bar.firstElementChild as HTMLElement).style.width = `${s.stt.progress}%`;
  } else {
    bar.hidden = true;
    sttState.textContent =
      s.stt.kind === 'ready'
        ? 'Ready, runs on this PC'
        : s.stt.kind === 'error'
          ? `Couldn't load: ${s.stt.message}`
          : 'Runs on this PC';
  }

  // Hotkey fallback
  const hk = $<HTMLSelectElement>('hotkey');
  hk.disabled = !s.hotkeyAvailable;
  $('hotkey-note').textContent = s.hotkeyAvailable
    ? 'Hold, speak, release'
    : `Keyboard hook unavailable. Press ${comboLabel} to start and again to stop`;

  // Last exchange
  $('last').hidden = !s.lastQuestion;
  $('last-q').textContent = s.lastQuestion;
  $('last-a').textContent = s.lastAnswer || (s.state === 'thinking' ? '…' : '');

  $('version').textContent = `v${s.version}`;
}

// ------------------------------------------------------------ settings

function renderSettings(s: Settings) {
  settings = s;
  $<HTMLSelectElement>('model').value = s.model;
  if ($<HTMLSelectElement>('model').value !== s.model) {
    // A custom model ID set by hand in settings.json.
    const o = new Option(s.model, s.model);
    $<HTMLSelectElement>('model').add(o);
    $<HTMLSelectElement>('model').value = s.model;
  }
  for (const b of $('effort').querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(b.dataset.value === s.effort));
  }
  $<HTMLSelectElement>('hotkey').value = s.hotkey;
  $<HTMLSelectElement>('stt').value = s.whisperModel;
  $<HTMLInputElement>('speak').checked = s.speakReplies;
  $<HTMLInputElement>('rate').value = String(s.speechRate);
  $('rate-value').textContent = `${s.speechRate.toFixed(2).replace(/0$/, '')}×`;
  $<HTMLInputElement>('idle').checked = s.showWhenIdle;
  $<HTMLInputElement>('login').checked = s.launchAtLogin;
  $<HTMLSelectElement>('voice').value = s.voiceName;
  $<HTMLSelectElement>('voice').disabled = !s.speakReplies;
  $<HTMLInputElement>('rate').disabled = !s.speakReplies;
}

async function update(patch: Partial<Settings>) {
  const r = await perch.invoke<{ settings: Settings; comboLabel: string }>('panel:update-settings', patch);
  comboLabel = r.comboLabel;
  renderSettings(r.settings);
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

async function saveKey(input: HTMLInputElement, errorEl?: HTMLElement) {
  const r = await perch.invoke<{ ok: boolean; error?: string }>('panel:set-key', input.value);
  if (r.ok) {
    input.value = '';
    $('key-form').hidden = true;
    if (errorEl) errorEl.hidden = true;
  } else if (errorEl) {
    errorEl.textContent = r.error ?? 'Could not save the key.';
    errorEl.hidden = false;
  } else {
    alert(r.error);
  }
}

$('onboard-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void saveKey($<HTMLInputElement>('onboard-key'), $('onboard-error'));
});
$('key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void saveKey($<HTMLInputElement>('key-input'));
});
$('key-change').addEventListener('click', () => {
  const f = $('key-form');
  f.hidden = !f.hidden;
  if (!f.hidden) $<HTMLInputElement>('key-input').focus();
});
$('key-remove').addEventListener('click', () => {
  if (confirm('Remove the saved API key from this PC?')) void perch.invoke('panel:clear-key');
});

document.querySelectorAll<HTMLAnchorElement>('a[data-url]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    perch.send('panel:open-url', a.dataset.url);
  }),
);

$('model').addEventListener('change', (e) => update({ model: (e.target as HTMLSelectElement).value }));
$('effort').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.value;
  if (v) void update({ effort: v as Settings['effort'] });
});
$('hotkey').addEventListener('change', (e) => update({ hotkey: (e.target as HTMLSelectElement).value as Settings['hotkey'] }));
$('stt').addEventListener('change', (e) =>
  update({ whisperModel: (e.target as HTMLSelectElement).value as Settings['whisperModel'] }),
);
$('speak').addEventListener('change', (e) => update({ speakReplies: (e.target as HTMLInputElement).checked }));
$('voice').addEventListener('change', (e) => update({ voiceName: (e.target as HTMLSelectElement).value }));
$('rate').addEventListener('input', (e) => {
  $('rate-value').textContent = `${Number((e.target as HTMLInputElement).value).toFixed(2).replace(/0$/, '')}×`;
});
$('rate').addEventListener('change', (e) => update({ speechRate: Number((e.target as HTMLInputElement).value) }));
$('test-voice').addEventListener('click', () =>
  perch.send('panel:test-voice', { voiceName: settings.voiceName, rate: settings.speechRate }),
);
$('idle').addEventListener('change', (e) => update({ showWhenIdle: (e.target as HTMLInputElement).checked }));
$('login').addEventListener('change', (e) => update({ launchAtLogin: (e.target as HTMLInputElement).checked }));
$('new-convo').addEventListener('click', () => perch.send('panel:new-conversation'));
$('quit').addEventListener('click', () => perch.send('panel:quit'));

perch.on('panel:status', (s: AppStatus) => renderStatus(s));

// ------------------------------------------------------------ init

speechSynthesis.onvoiceschanged = fillVoices;
(async () => {
  const init = await perch.invoke<{ settings: Settings; status: AppStatus; comboLabel: string }>('panel:get');
  if (!init) {
    // Design preview in a plain browser: panel.html?demo
    if (location.search.includes('demo')) {
      const { DEFAULT_SETTINGS } = await import('../shared/types');
      renderSettings(DEFAULT_SETTINGS);
      renderStatus({
        state: 'idle',
        stt: { kind: 'loading', progress: 42 },
        hasApiKey: location.search.includes('key'),
        hotkeyAvailable: true,
        lastQuestion: location.search.includes('key') ? 'How do I add a page number in Word?' : '',
        lastAnswer: 'Click the Insert tab at the top, then choose Page Number on the right side of the ribbon.',
        error: '',
        version: '0.1.0',
      });
    }
    return;
  }
  comboLabel = init.comboLabel;
  renderSettings(init.settings);
  renderStatus(init.status);
  fillVoices();
})();
