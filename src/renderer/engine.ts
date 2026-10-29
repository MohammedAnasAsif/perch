// Hidden "engine" page: microphone capture, local speech recognition (in a
// worker) and text-to-speech with the voices installed in Windows.
import { perch } from './bridge';
import type { Settings, SpeakItem } from '../shared/types';

const log = (...a: unknown[]) => perch.send('engine:log', ...a.map(String));

let settings: Settings | null = null;

// ------------------------------------------------------------ speech recognition

const worker = new Worker(new URL('./stt-worker.js', location.href), { type: 'module' });
let nextId = 1;
const pending = new Map<number, (r: { text: string; error?: string }) => void>();

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'status') perch.send('engine:stt-status', m.status);
  if (m.type === 'result') {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
};
worker.onerror = (e) => {
  log('stt worker error', e.message);
  perch.send('engine:stt-status', { kind: 'error', message: e.message || 'Speech model failed to start.' });
};

function transcribe(audio: Float32Array): Promise<{ text: string; error?: string }> {
  const id = nextId++;
  const multilingual = !settings?.whisperModel.endsWith('.en');
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ type: 'transcribe', id, audio, multilingual }, [audio.buffer]);
  });
}

// ------------------------------------------------------------ microphone

// The mic stays open briefly after each use so follow-up questions start
// instantly, then closes so Windows' "microphone in use" icon goes away.
const MIC_IDLE_CLOSE_MS = 30_000;
const MIN_SPEECH_MS = 300;

let stream: MediaStream | null = null;
let micCloseTimer: ReturnType<typeof setTimeout> | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let recordStartedAt = 0;
let cancelled = false;
let wantRecording = false;
let micFailed = false;
let session = 0; // bumps on every new recording so stale transcripts are dropped
let levelCtx: AudioContext | null = null;
let levelRaf = 0;

async function getStream(): Promise<MediaStream> {
  if (micCloseTimer) clearTimeout(micCloseTimer);
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return stream;
}

function scheduleMicClose() {
  if (micCloseTimer) clearTimeout(micCloseTimer);
  micCloseTimer = setTimeout(() => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }, MIC_IDLE_CLOSE_MS);
}

function startLevelMeter(s: MediaStream) {
  stopLevelMeter();
  levelCtx = new AudioContext();
  const src = levelCtx.createMediaStreamSource(s);
  const analyser = levelCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let last = 0;
  const tick = (t: number) => {
    levelRaf = requestAnimationFrame(tick);
    if (t - last < 50) return; // ~20 updates a second is plenty
    last = t;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    perch.send('engine:level', Math.min(1, rms * 6));
  };
  levelRaf = requestAnimationFrame(tick);
}

function stopLevelMeter() {
  cancelAnimationFrame(levelRaf);
  void levelCtx?.close();
  levelCtx = null;
}

async function recordStart() {
  stopSpeaking();
  session++;
  cancelled = false;
  wantRecording = true;
  micFailed = false;
  chunks = [];
  try {
    const s = await getStream();
    // The keys may already have been released while the mic was opening.
    if (cancelled || !wantRecording) return;
    recorder = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(100);
    recordStartedAt = performance.now();
    startLevelMeter(s);
  } catch (err) {
    log('mic error', err);
    micFailed = true;
    const denied = (err as DOMException)?.name === 'NotAllowedError';
    perch.send('engine:transcript', {
      text: '',
      error: denied
        ? 'I can\'t use the microphone. Allow microphone access for desktop apps in Windows privacy settings.'
        : "I couldn't find a microphone.",
    });
  }
}

function stopRecorder(): Promise<Blob | null> {
  stopLevelMeter();
  const r = recorder;
  recorder = null;
  if (!r || r.state === 'inactive') return Promise.resolve(null);
  return new Promise((resolve) => {
    r.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
    r.stop();
  });
}

async function recordStop() {
  wantRecording = false;
  const mySession = session;
  const duration = performance.now() - recordStartedAt;
  const blob = await stopRecorder();
  scheduleMicClose();
  if (cancelled || micFailed) return;
  if (!blob || duration < MIN_SPEECH_MS) {
    perch.send('engine:transcript', { text: '' });
    return;
  }
  try {
    const audio = await decodeTo16k(blob);
    const result = await transcribe(audio);
    if (mySession === session) perch.send('engine:transcript', result);
  } catch (err) {
    log('transcribe error', err);
    if (mySession === session) {
      perch.send('engine:transcript', { text: '', error: 'Speech recognition failed. Try again.' });
    }
  }
}

async function recordCancel() {
  cancelled = true;
  wantRecording = false;
  await stopRecorder();
  scheduleMicClose();
}

/** Whisper wants 16 kHz mono float samples. */
async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await ctx.decodeAudioData(buf);
  if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

// ------------------------------------------------------------ speech output

let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => (voices = speechSynthesis.getVoices());
loadVoices();
speechSynthesis.onvoiceschanged = loadVoices;

function pickVoice(name: string): SpeechSynthesisVoice | null {
  if (!voices.length) loadVoices();
  if (name) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  const lang = navigator.language || 'en-US';
  return (
    voices.find((v) => v.lang === lang && /natural/i.test(v.name)) ||
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.startsWith('en') && v.default) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    null
  );
}

let speakGeneration = 0;

function speak(item: SpeakItem & { voiceName?: string; rate?: number }) {
  const gen = speakGeneration;
  const u = new SpeechSynthesisUtterance(item.text);
  const v = pickVoice(item.voiceName ?? settings?.voiceName ?? '');
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = item.rate ?? settings?.speechRate ?? 1;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    if (gen === speakGeneration && item.id >= 0) perch.send('engine:utterance-end', item.id);
  };
  u.onstart = () => {
    if (gen === speakGeneration && item.id >= 0) perch.send('engine:utterance-start', item.id);
  };
  u.onend = end;
  u.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') log('tts error', e.error);
    end();
  };
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  speakGeneration++;
  speechSynthesis.cancel();
}

// ------------------------------------------------------------ wiring

perch.on('engine:settings', (s: Settings) => {
  const modelChanged = s.whisperModel !== settings?.whisperModel;
  settings = s;
  if (modelChanged) worker.postMessage({ type: 'load', model: s.whisperModel });
});
perch.on('engine:record-start', () => void recordStart());
perch.on('engine:record-stop', () => void recordStop());
perch.on('engine:record-cancel', () => void recordCancel());
perch.on('engine:speak', (item) => speak(item));
perch.on('engine:speak-stop', () => stopSpeaking());
