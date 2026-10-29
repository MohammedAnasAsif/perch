// Streaming helpers for Claude's replies. Pure functions, no Electron, so they
// can be unit-tested with plain Node.

/** Something to draw in addition to pointing. Coordinates are in the model's space. */
export type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'box'; w: number; h: number }
  /** an arrow from (fromX, fromY) to the point's (x, y) */
  | { kind: 'arrow'; fromX: number; fromY: number };

export interface PointTag {
  /** Where the buddy points (for a box: its top-left corner; for an arrow: its head). */
  x: number;
  y: number;
  label: string;
  shape?: Shape;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'point'; point: PointTag }
  /** The chat model is handing the request to agent mode. */
  | { type: 'agent' }
  /** [REMEMBER:fact] */
  | { type: 'remember'; text: string }
  /** [REMIND:when|text] (raw; parsed with parseReminder) */
  | { type: 'remind'; body: string };

const TAG_OPENS = ['[POINT:', '[CIRCLE:', '[BOX:', '[ARROW:', '[REMEMBER:', '[REMIND:'];
const NOTE_RE = /^\[(REMEMBER|REMIND):([^\]]*)\]/i;
const AGENT_TAG = '[AGENT]';
// [POINT:x,y:label] [CIRCLE:x,y,r:label] [BOX:x,y,w,h:label] [ARROW:x1,y1,x2,y2:label]
// Labels are optional; numbers may be decimals.
const TAG_RE = /^\[(POINT|CIRCLE|BOX|ARROW):([^\]:]*)(?::([^\]]*))?\]/i;
const COUNTS: Record<string, number> = { POINT: 2, CIRCLE: 3, BOX: 4, ARROW: 4 };

function parseTag(kind: string, numsText: string, label: string): PointTag | null {
  const nums = numsText.split(',').map((n) => Number(n.trim()));
  const k = kind.toUpperCase();
  if (nums.length !== COUNTS[k] || nums.some((n) => !Number.isFinite(n))) return null;
  label = label.trim();
  switch (k) {
    case 'POINT':
      return { x: nums[0], y: nums[1], label };
    case 'CIRCLE':
      return { x: nums[0], y: nums[1], label, shape: { kind: 'circle', r: Math.abs(nums[2]) } };
    case 'BOX':
      return { x: nums[0], y: nums[1], label, shape: { kind: 'box', w: Math.abs(nums[2]), h: Math.abs(nums[3]) } };
    case 'ARROW':
      return { x: nums[2], y: nums[3], label, shape: { kind: 'arrow', fromX: nums[0], fromY: nums[1] } };
  }
  return null;
}

const startsWithOpen = (b: string) => TAG_OPENS.some((t) => b.toUpperCase().startsWith(t));
const prefixOfOpen = (b: string) => TAG_OPENS.some((t) => t.startsWith(b.toUpperCase()));
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

      if (this.buf.toUpperCase().startsWith(AGENT_TAG)) {
        if (text) events.push({ type: 'text', text }), (text = '');
        events.push({ type: 'agent' });
        this.buf = this.buf.slice(AGENT_TAG.length);
        continue;
      }

      const note = NOTE_RE.exec(this.buf);
      if (note) {
        if (text) events.push({ type: 'text', text }), (text = '');
        const body = note[2].trim();
        if (body) {
          events.push(note[1].toUpperCase() === 'REMEMBER' ? { type: 'remember', text: body } : { type: 'remind', body });
        }
        this.buf = this.buf.slice(note[0].length).replace(/^ /, '');
        continue;
      }

      const m = TAG_RE.exec(this.buf);
      if (m) {
        const point = parseTag(m[1], m[2], m[3] ?? '');
        if (point) {
          if (text) events.push({ type: 'text', text }), (text = '');
          events.push({ type: 'point', point });
        }
        // A malformed tag is dropped rather than read aloud.
        this.buf = this.buf.slice(m[0].length);
        continue;
      }

      // Could this still become a tag once more text arrives?
      const couldBeTag =
        !final &&
        this.buf.length < MAX_TAG_LEN &&
        (prefixOfOpen(this.buf) ||
          AGENT_TAG.startsWith(this.buf.toUpperCase()) ||
          (startsWithOpen(this.buf) && !this.buf.includes(']')));
      if (couldBeTag) break;

      if (startsWithOpen(this.buf)) {
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
  return text
    .replace(/\[(POINT|CIRCLE|BOX|ARROW|REMEMBER|REMIND):[^\]]*\]\s?/gi, '')
    .replace(/\[AGENT\]\s?/gi, '');
}
