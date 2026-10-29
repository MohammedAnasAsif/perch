// Speech-to-text worker. Runs OpenAI's Whisper locally with transformers.js
// (ONNX Runtime WebAssembly), so speech never leaves the computer and no API
// key is needed. The model downloads once from Hugging Face and is cached.
import { env, pipeline } from '@huggingface/transformers';

type InMsg =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; multilingual: boolean };

// Serve ONNX Runtime from Perch itself rather than a CDN.
const base = new URL('./ort/', self.location.href).href;
(env.backends.onnx as any).wasm.wasmPaths = {
  mjs: base + 'ort-wasm-simd-threaded.asyncify.mjs',
  wasm: base + 'ort-wasm-simd-threaded.asyncify.wasm',
};
const cores = (self.navigator as any).hardwareConcurrency ?? 4;
(env.backends.onnx as any).wasm.numThreads = Math.max(1, Math.min(4, cores - 1));
env.allowLocalModels = false;
env.useBrowserCache = true;

let asr: any = null;
let loadedModel = '';
let wantedModel = 'Xenova/whisper-base.en';
let loading: Promise<void> | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

function friendly(err: unknown) {
  const m = String((err as Error)?.message ?? err);
  if (/fetch|network|Failed to load/i.test(m)) {
    return "Couldn't download the speech model. Check your internet connection.";
  }
  return m;
}

async function load(model: string) {
  wantedModel = model;
  if (asr && loadedModel === model) return;
  if (loading && loadedModel === model) return loading;
  loadedModel = model;
  loading = (async () => {
    post({ type: 'status', status: { kind: 'loading', progress: 0 } });
    const files = new Map<string, { loaded: number; total: number }>();
    try {
      asr?.dispose?.();
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, { loaded: p.loaded, total: p.total });
            let loaded = 0,
              total = 0;
            for (const f of files.values()) (loaded += f.loaded), (total += f.total);
            post({ type: 'status', status: { kind: 'loading', progress: (loaded / total) * 100, file: p.file } });
          }
        },
      });
      // Warm up so the first real request is quick.
      await asr(new Float32Array(16000));
      post({ type: 'status', status: { kind: 'ready' } });
    } catch (err) {
      asr = null;
      loadedModel = '';
      post({ type: 'status', status: { kind: 'error', message: friendly(err) } });
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    load(msg.model).catch(() => {});
    return;
  }
  if (msg.type === 'transcribe') {
    try {
      if (loading) await loading;
      if (!asr) await load(wantedModel);
      const opts: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5 };
      if (msg.multilingual) opts.task = 'transcribe';
      const out = await asr(msg.audio, opts);
      const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? '';
      post({ type: 'result', id: msg.id, text: String(text).trim() });
    } catch (err) {
      post({ type: 'result', id: msg.id, text: '', error: friendly(err) });
    }
  }
};
