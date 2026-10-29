// Wake phrase matching and a tiny energy-based voice activity detector.
// Pure logic so both can be unit-tested.

// Whisper often mishears "Perch", so accept close-sounding words.
const WAKE_RE =
  /^\W*(?:(?:hey|hi|hay|okay|ok|a)[\s,.!-]+)?(?:perch|birch|purch|porch|perj|perched|pearch|purge|perk|church)\b[\s,.!?:;-]*(.*)$/is;

/**
 * If a transcript starts with the wake phrase ("Hey Perch, …"), returns the
 * rest (possibly ''), otherwise null.
 */
export function matchWake(transcript: string): string | null {
  const m = WAKE_RE.exec(transcript.trim());
  if (!m) return null;
  return m[1].replace(/^[\s,.!?]+|[\s]+$/g, '');
}

export interface VadOptions {
  frameMs: number;
  /** speech must last this long to count */
  minSpeechMs: number;
  /** end the segment after this much silence */
  hangoverMs: number;
  /** never longer than this */
  maxSegmentMs: number;
  /** audio kept from before speech starts */
  preRollMs: number;
}

export const DEFAULT_VAD: VadOptions = {
  frameMs: 64,
  minSpeechMs: 350,
  hangoverMs: 750,
  maxSegmentMs: 10_000,
  preRollMs: 320,
};

/**
 * Splits a stream of audio frames into speech segments using the frame energy
 * against an adaptive noise floor.
 */
export class Vad {
  private noise = 0.004;
  private inSpeech = false;
  private speechMs = 0;
  private silenceMs = 0;
  private frames: Float32Array[] = [];
  private preRoll: Float32Array[] = [];

  constructor(
    private onSegment: (audio: Float32Array) => void,
    private opt: VadOptions = DEFAULT_VAD,
  ) {}

  static rms(frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / Math.max(1, frame.length));
  }

  push(frame: Float32Array) {
    const level = Vad.rms(frame);
    const threshold = Math.max(0.012, this.noise * 3);
    const speech = level > threshold;
    if (!speech) {
      // Track the background level slowly.
      this.noise = this.noise * 0.95 + level * 0.05;
    }

    if (!this.inSpeech) {
      this.preRoll.push(frame);
      const keep = Math.ceil(this.opt.preRollMs / this.opt.frameMs);
      while (this.preRoll.length > keep) this.preRoll.shift();
      if (speech) {
        this.inSpeech = true;
        this.speechMs = this.opt.frameMs;
        this.silenceMs = 0;
        this.frames = [...this.preRoll];
        this.preRoll = [];
      }
      return;
    }

    this.frames.push(frame);
    if (speech) {
      this.speechMs += this.opt.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.opt.frameMs;
    }
    const total = this.frames.length * this.opt.frameMs;
    if (this.silenceMs >= this.opt.hangoverMs || total >= this.opt.maxSegmentMs) this.flush();
  }

  private flush() {
    const frames = this.frames;
    const enough = this.speechMs >= this.opt.minSpeechMs;
    this.inSpeech = false;
    this.frames = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    if (!enough) return;
    const len = frames.reduce((n, f) => n + f.length, 0);
    const out = new Float32Array(len);
    let o = 0;
    for (const f of frames) out.set(f, (o += f.length) - f.length);
    this.onSegment(out);
  }

  reset() {
    this.inSpeech = false;
    this.frames = [];
    this.preRoll = [];
    this.speechMs = 0;
    this.silenceMs = 0;
  }
}
