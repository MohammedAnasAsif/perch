// Natural-sounding speech with Kokoro (82M-parameter TTS model, Apache-2.0),
// running locally in this worker.
//
// The Kokoro web bundle includes eSpeak NG (GPL) for pronunciation, so Perch
// doesn't ship it in its installer. It's downloaded on first use from a pinned
// version, and its SHA-256 is checked before it runs. The model (~90 MB) is
// then downloaded from Hugging Face and cached.

const KOKORO_VERSION = '1.2.1';
const KOKORO_SHA256 = '6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f';
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/kokoro-js@${KOKORO_VERSION}/dist/kokoro.web.js`,
  `https://unpkg.com/kokoro-js@${KOKORO_VERSION}/dist/kokoro.web.js`,
];
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type InMsg = { type: 'load' } | { type: 'speak'; id: number; gen: number; text: string; voice: string; speed: number };

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let tts: any = null;
let loading: Promise<void> | null = null;

async function sha256Hex(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchLibrary(): Promise<string> {
  let lastErr: unknown;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const hash = await sha256Hex(buf);
      if (hash !== KOKORO_SHA256) throw new Error('downloaded voice engine failed its integrity check');
      return URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not download the voice engine.');
}

async function load() {
  if (tts) return;
  if (loading) return loading;
  loading = (async () => {
    post({ type: 'status', status: { kind: 'loading', progress: 0 } });
    try {
      const libUrl = await fetchLibrary();
      const { KokoroTTS } = await import(/* @vite-ignore */ libUrl);
      const files = new Map<string, { loaded: number; total: number }>();
      tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, { loaded: p.loaded, total: p.total });
            let loaded = 0,
              total = 0;
            for (const f of files.values()) (loaded += f.loaded), (total += f.total);
            post({ type: 'status', status: { kind: 'loading', progress: (loaded / total) * 100 } });
          }
        },
      });
      post({ type: 'status', status: { kind: 'ready' } });
    } catch (err) {
      tts = null;
      const msg = String((err as Error)?.message ?? err);
      post({
        type: 'status',
        status: {
          kind: 'error',
          message: /fetch|network|HTTP/i.test(msg) ? "Couldn't download the natural voice. Check your internet connection." : msg,
        },
      });
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const m = e.data;
  if (m.type === 'load') {
    load().catch(() => {});
    return;
  }
  if (m.type === 'speak') {
    try {
      if (!tts) await load();
      const audio = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
      const samples: Float32Array = audio.audio;
      post({ type: 'audio', id: m.id, gen: m.gen, rate: audio.sampling_rate, samples }, [samples.buffer]);
    } catch (err) {
      post({ type: 'audio-error', id: m.id, gen: m.gen, message: String((err as Error)?.message ?? err) });
    }
  }
};
