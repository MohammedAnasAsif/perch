// Local models through Ollama (https://ollama.com). Free, private and offline,
// but needs a reasonably strong PC. Recommended: qwen3-vl (reads screenshots).
import { AiError, readLines, type Provider, type StreamOptions } from './types';

export const OLLAMA_SUGGESTED = [
  { id: 'qwen3-vl:8b', label: 'Qwen3-VL 8B (6.2 GB, needs ~16 GB RAM)' },
  { id: 'qwen3-vl:4b', label: 'Qwen3-VL 4B (3.3 GB, for 8 GB RAM)' },
  { id: 'qwen3-vl:2b', label: 'Qwen3-VL 2B (1.9 GB, fastest, least accurate)' },
];

export function ollamaProvider(getUrl: () => string): Provider {
  return {
    id: 'ollama',
    // Qwen3-VL (and most current local vision models) use a 0–1000 scale;
    // Qwen2.5-VL used real pixels.
    coordSpace: (model) => (/qwen2\.5/i.test(model) ? 'pixels' : 'norm1000'),
    async stream(opts: StreamOptions, onText) {
      let res: Response;
      try {
        res = await fetch(`${getUrl().replace(/\/+$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            ...(opts.json ? { format: 'json' } : {}),
            options: { num_predict: opts.maxTokens },
            messages: [
              { role: 'system', content: opts.system },
              ...opts.messages.map((m) => ({
                role: m.role,
                content: m.text,
                ...(m.image ? { images: [m.image.data] } : {}),
              })),
            ],
          }),
          signal: opts.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        throw new AiError('OLLAMA_UNREACHABLE', undefined, 'ollama');
      }
      if (!res.ok || !res.body) {
        let msg = `Ollama returned ${res.status}`;
        try {
          msg = (await res.json())?.error ?? msg;
        } catch {
          /* keep default */
        }
        throw new AiError(msg, res.status, 'ollama');
      }

      let full = '';
      for await (const line of readLines(res.body, opts.signal)) {
        if (!line.trim()) continue;
        let chunk: any;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        if (chunk.error) throw new AiError(String(chunk.error), 500, 'ollama');
        const text = chunk.message?.content;
        if (typeof text === 'string' && text) {
          full += text;
          onText(text);
        }
        if (chunk.done) break;
      }
      return full;
    },
  };
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
  error?: string;
}

/** Is Ollama running, and which models are installed? */
export async function ollamaStatus(url: string): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { running: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (data.models ?? []).map((m) => m.name).sort() };
  } catch (err) {
    return { running: false, models: [], error: (err as Error).message };
  }
}
