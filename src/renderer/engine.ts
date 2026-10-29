// Hidden "engine" page: microphone capture, local speech recognition (in a
// worker) and text-to-speech with the voices installed in Windows.
import { perch } from './bridge';
import type { Settings, SpeakItem } from '../shared/types';
import { matchWake, Vad } from '../shared/wake';

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
  if (wakeCtx) return; // the wake word keeps the mic open
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

// ---- Natural voice (Kokoro, in a worker) ----
const ttsWorker = new Worker(new URL('./tts-worker.js', location.href), { type: 'module' });
let ttsReady = false;
let ttsLoadRequested = false;
const ttsOrder: number[] = []; // ids in the order they must be played
const ttsAudio = new Map<number, { samples: Float32Array; rate: number } | 'error'>();
let ttsPlaying = false;
let ttsSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;
let negativeIds = -1000; // ids for speech nobody tracks (tests, "On it.")

ttsWorker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'status') {
    ttsReady = m.status.kind === 'ready';
    perch.send('engine:tts-status', m.status);
    return;
  }
  if (m.gen !== speakGeneration) return; // stopped since
  ttsAudio.set(m.id, m.type === 'audio' ? { samples: m.samples, rate: m.rate } : 'error');
  if (m.type === 'audio-error') log('natural voice error', m.message);
  pumpNatural();
};

function ensureNaturalVoice() {
  if (ttsLoadRequested) return;
  ttsLoadRequested = true;
  ttsWorker.postMessage({ type: 'load' });
}

const utterStart = (id: number) => id >= 0 && perch.send('engine:utterance-start', id);
const utterEnd = (id: number) => id >= 0 && perch.send('engine:utterance-end', id);

function speakNatural(item: SpeakItem & { rate?: number }) {
  const id = item.id >= 0 ? item.id : negativeIds--;
  ttsOrder.push(id);
  ttsWorker.postMessage({
    type: 'speak',
    id,
    gen: speakGeneration,
    text: item.text,
    voice: settings?.naturalVoice || 'af_heart',
    speed: item.rate ?? settings?.speechRate ?? 1,
  });
}

function pumpNatural() {
  if (ttsPlaying) return;
  const id = ttsOrder[0];
  if (id === undefined) return;
  const audio = ttsAudio.get(id);
  if (!audio) return; // still generating
  ttsOrder.shift();
  ttsAudio.delete(id);
  if (audio === 'error') {
    utterStart(id);
    utterEnd(id);
    pumpNatural();
    return;
  }
  audioCtx ??= new AudioContext();
  const buffer = audioCtx.createBuffer(1, audio.samples.length, audio.rate);
  buffer.copyToChannel(audio.samples as Float32Array<ArrayBuffer>, 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.onended = () => {
    if (ttsSource !== src) return;
    ttsSource = null;
    ttsPlaying = false;
    utterEnd(id);
    pumpNatural();
  };
  ttsSource = src;
  ttsPlaying = true;
  utterStart(id);
  src.start();
}

function stopNatural() {
  ttsOrder.length = 0;
  ttsAudio.clear();
  const src = ttsSource;
  ttsSource = null;
  ttsPlaying = false;
  if (src) {
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }
}

function speak(item: SpeakItem & { voiceName?: string; rate?: number }) {
  // Natural voice when it's on and downloaded; Windows voices meanwhile.
  if (settings?.voiceEngine === 'natural' && ttsReady) return speakNatural(item);
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
  stopNatural();
}

// ------------------------------------------------------------ wake word

// "Hey Perch": while enabled, the mic stays open and a simple voice-activity
// detector cuts speech into short segments. Each segment is transcribed
// locally; if it starts with the wake phrase, Perch wakes up. Nothing leaves
// the PC unless a request follows.
let wakeCtx: AudioContext | null = null;
let wakeSrc: MediaStreamAudioSourceNode | null = null;
let wakeNode: ScriptProcessorNode | null = null;
let vad: Vad | null = null;
let awaitingCommandUntil = 0;
let wakeQueue: Promise<void> = Promise.resolve();

const isSpeakingNow = () => speechSynthesis.speaking || ttsPlaying;

async function startWake() {
  if (wakeCtx) return;
  try {
    const s = await getStream();
    if (micCloseTimer) clearTimeout(micCloseTimer);
    const ctx = new AudioContext({ sampleRate: 16000 });
    wakeCtx = ctx;
    wakeSrc = ctx.createMediaStreamSource(s);
    // 1024 samples at 16 kHz = 64 ms frames, matching the detector's settings.
    wakeNode = ctx.createScriptProcessor(1024, 1, 1);
    vad = new Vad((audio) => {
      wakeQueue = wakeQueue.then(() => onWakeSegment(audio)).catch((err) => log('wake error', err));
    });
    wakeNode.onaudioprocess = (e) => {
      // Ignore our own voice and push-to-talk recordings.
      if (recorder || isSpeakingNow()) return vad?.reset();
      vad?.push(e.inputBuffer.getChannelData(0).slice());
    };
    wakeSrc.connect(wakeNode);
    wakeNode.connect(ctx.destination); // required for processing; outputs silence
    log('wake word: listening');
  } catch (err) {
    log('wake word mic error', err);
    wakeCtx = null;
  }
}

function stopWake() {
  wakeNode?.disconnect();
  wakeSrc?.disconnect();
  void wakeCtx?.close();
  wakeCtx = null;
  wakeNode = null;
  wakeSrc = null;
  vad = null;
  awaitingCommandUntil = 0;
  scheduleMicClose();
}

async function onWakeSegment(audio: Float32Array) {
  const { text, error } = await transcribe(audio);
  if (error || !text.trim()) return;
  if (awaitingCommandUntil > Date.now()) {
    // This is the request that follows a bare "Hey Perch".
    awaitingCommandUntil = 0;
    perch.send('engine:wake', { text: text.trim(), command: true });
    return;
  }
  const rest = matchWake(text);
  if (rest === null) return;
  log('wake word heard');
  if (rest.split(/\s+/).filter(Boolean).length >= 2) {
    perch.send('engine:wake', { text: rest, command: true });
    return;
  }
  awaitingCommandUntil = Date.now() + 7000;
  perch.send('engine:wake', { text: '', command: false });
  setTimeout(() => {
    if (awaitingCommandUntil && Date.now() >= awaitingCommandUntil) {
      awaitingCommandUntil = 0;
      perch.send('engine:wake-timeout');
    }
  }, 7100);
}

// ------------------------------------------------------------ wiring

perch.on('engine:settings', (s: Settings) => {
  const modelChanged = s.whisperModel !== settings?.whisperModel;
  settings = s;
  if (modelChanged) worker.postMessage({ type: 'load', model: s.whisperModel });
  if (s.voiceEngine === 'natural' && s.speakReplies) ensureNaturalVoice();
  if (s.wakeWord) void startWake();
  else if (wakeCtx) stopWake();
});
perch.on('engine:record-start', () => void recordStart());
perch.on('engine:record-stop', () => void recordStop());
perch.on('engine:record-cancel', () => void recordCancel());
perch.on('engine:speak', (item) => speak(item));
perch.on('engine:speak-stop', () => stopSpeaking());
