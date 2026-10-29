// Claude (Anthropic API). Paid; best quality, especially for pointing and agents.
import Anthropic from '@anthropic-ai/sdk';
import { AiError, type Provider, type StreamOptions } from './types';

export function claudeProvider(getKey: () => string | null): Provider {
  return {
    id: 'claude',
    coordSpace: () => 'pixels',
    async stream(opts: StreamOptions, onText) {
      const apiKey = getKey();
      if (!apiKey) throw new AiError('NO_KEY', undefined, 'claude');
      const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });

      const messages: Anthropic.MessageParam[] = opts.messages.map((m) => {
        if (!m.image) return { role: m.role, content: m.text };
        return {
          role: m.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image.data } },
            { type: 'text', text: m.text },
          ],
        };
      });

      let full = '';
      try {
        const stream = client.messages.stream(
          {
            model: opts.model,
            max_tokens: opts.maxTokens,
            system: opts.system,
            messages,
            ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
          },
          { signal: opts.signal },
        );
        stream.on('text', (delta: string) => {
          full += delta;
          onText(delta);
        });
        await stream.finalMessage();
      } catch (err) {
        const e = err as { status?: number; name?: string; message?: string };
        if (e?.name === 'APIUserAbortError' || e?.name === 'AbortError') throw err;
        throw new AiError(e?.message ?? 'Claude request failed', e?.status, 'claude');
      }
      return full;
    },
  };
}
