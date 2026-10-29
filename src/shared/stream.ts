// Streaming helpers for Claude's replies. Pure functions, no Electron, so they
// can be unit-tested with plain Node.

export interface PointTag {
  x: number;
  y: number;
  label: string;
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'point'; point: PointTag };

const TAG_OPEN = '[POINT:';
// [POINT:x,y:label]  — label optional, coordinates may be decimals.
const TAG_RE = /^\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?::([^\]]*))?\]/;
const MAX_TAG_LEN = 200;

/**
 * Splits a streamed reply into plain text and [POINT:x,y:label] tags, even when
 * a tag is split across several stream chunks.
 */
export class TagStream {
  private buf = '';

  push(chunk: string): StreamEvent[] {
    this.buf += chunk;
    return this.drain(false);
  }

  /** Call once the stream is complete to flush anything held back. */
  end(): StreamEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): StreamEvent[] {
    const events: StreamEvent[] = [];
    let text = '';
    while (this.buf.length) {
      const i = this.buf.indexOf('[');
      if (i === -1) {
        text += this.buf;
        this.buf = '';
        break;
      }
      text += this.buf.slice(0, i);
      this.buf = this.buf.slice(i);

      const m = TAG_RE.exec(this.buf);
      if (m) {
        if (text) events.push({ type: 'text', text }), (text = '');
        events.push({
          type: 'point',
          point: { x: Number(m[1]), y: Number(m[2]), label: (m[3] ?? '').trim() },
        });
        this.buf = this.buf.slice(m[0].length);
        continue;
      }

      // Could this still become a tag once more text arrives?
      const couldBeTag =
        !final &&
        this.buf.length < MAX_TAG_LEN &&
        (TAG_OPEN.startsWith(this.buf) ||
          (this.buf.startsWith(TAG_OPEN) && !this.buf.includes(']')));
      if (couldBeTag) break;

      if (this.buf.startsWith(TAG_OPEN)) {
        // A malformed tag: drop it rather than reading it aloud.
        const close = this.buf.indexOf(']');
        this.buf = close === -1 ? '' : this.buf.slice(close + 1);
      } else {
        text += '[';
        this.buf = this.buf.slice(1);
      }
    }
    if (text) events.push({ type: 'text', text });
    return events;
  }
}

/**
 * Collects streamed text and hands back whole sentences, so speech can start
 * before the full reply has arrived.
 */
export class SentenceChunker {
  private buf = '';

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    // A sentence ends at . ! ? … (plus closing quotes/brackets) followed by
    // whitespace, or at a line break.
    const re = /[^.!?…\n]*(?:[.!?…]+["'”’)\]]*(?=\s)|\n)/y;
    let consumed = 0;
    for (;;) {
      re.lastIndex = consumed;
      const m = re.exec(this.buf);
      if (!m || m[0].length === 0) break;
      const s = m[0].trim();
      consumed = re.lastIndex;
      if (s) out.push(s);
    }
    this.buf = this.buf.slice(consumed);
    return out;
  }

  end(): string[] {
    const s = this.buf.trim();
    this.buf = '';
    return s ? [s] : [];
  }
}

/** Removes things that sound bad when read aloud (markdown, URLs, emoji). */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[*_#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Display text for the speech bubble: the reply with tags removed. */
export function stripTags(text: string): string {
  return text.replace(/\[POINT:[^\]]*\]\s?/g, '');
}
