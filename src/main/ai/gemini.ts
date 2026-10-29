// Google Gemini via the Gemini API. Has a free tier (no credit card) with daily
// limits; on the free tier Google may use prompts to improve its products.
import { AiError, readLines, type Provider, type StreamOptions } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (higher free limits)' },
];

export function geminiProvider(getKey: () => string | null): Provider {
  return {
    id: 'gemini',
    // Gemini models are trained to give positions on a 0–1000 scale.
    coordSpace: () => 'norm1000',
    async stream(opts: StreamOptions, onText) {
      const apiKey = getKey();
      if (!apiKey) throw new AiError('NO_KEY', undefined, 'gemini');

      const body = {
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...(m.image ? [{ inlineData: { mimeType: 'image/jpeg', data: m.image.data } }] : []),
            { text: m.text },
          ],
        })),
        generationConfig: {
          maxOutputTokens: opts.maxTokens,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      };

      const res = await fetch(`${BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `Gemini returned ${res.status}`;
        try {
          msg = (await res.json())?.error?.message ?? msg;
        } catch {
          /* keep default */
        }
        throw new AiError(msg, res.status, 'gemini');
      }

      let full = '';
      for await (const line of readLines(res.body, opts.signal)) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        let chunk: any;
        try {
          chunk = JSON.parse(json);
        } catch {
          continue;
        }
        if (chunk.error) throw new AiError(chunk.error.message ?? 'Gemini error', chunk.error.code, 'gemini');
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought || typeof part.text !== 'string') continue; // skip thinking
          full += part.text;
          onText(part.text);
        }
        const reason = chunk.promptFeedback?.blockReason;
        if (reason) throw new AiError(`Gemini blocked the request (${reason}).`, 400, 'gemini');
      }
      return full;
    },
  };
}
