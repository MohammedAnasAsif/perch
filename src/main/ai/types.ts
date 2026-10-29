// A small common interface over the AI services Perch can use.

export type ProviderId = 'claude' | 'gemini' | 'ollama';

/** How a model writes screen coordinates. */
export type CoordSpace = 'pixels' | 'norm1000';

export interface ChatImage {
  /** base64 JPEG */
  data: string;
  width: number;
  height: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  image?: ChatImage;
}

export interface StreamOptions {
  system: string;
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  signal: AbortSignal;
  /** Ask for a single JSON object as the reply (agent mode). */
  json?: boolean;
  /** Claude only: how much effort to spend. */
  effort?: 'low' | 'medium' | 'high';
}

export interface Provider {
  id: ProviderId;
  /** Streams the reply text; resolves with the full text. */
  stream(opts: StreamOptions, onText: (delta: string) => void): Promise<string>;
  coordSpace(model: string): CoordSpace;
}

/** An error with an HTTP status and a message that's safe to show. */
export class AiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public provider?: ProviderId,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Reads a fetch() response body as a stream of lines. */
export async function* readLines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) !== -1) {
        yield buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
      }
    }
    buf += decoder.decode();
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}
