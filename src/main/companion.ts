// The companion's brain stem: wires hotkey -> microphone -> transcript ->
// screenshot + Claude -> speech bubble, voice and pointing.
import { screen, type BrowserWindow } from 'electron';
import { Brain, friendlyError } from './brain';
import { captureCursorDisplay, toDisplayLocal, type Screenshot } from './capture';
import { TagStream, SentenceChunker, cleanForSpeech, type PointTag } from '../shared/stream';
import type { Overlays } from './windows';
import type { AppStatus, BuddyState, PointMsg, Settings, SpeakItem, SttStatus } from '../shared/types';

const RELEASE_AFTER_MS = 2500; // buddy returns to the cursor this long after speaking
const POINT_DWELL_MS = 1600; // when not speaking, how long each point is shown

export interface CompanionDeps {
  overlays: Overlays;
  engine: () => BrowserWindow | null;
  settings: () => Settings;
  getKey: () => string | null;
  hasKey: () => boolean;
  onStatus: (s: AppStatus) => void;
  openPanel: () => void;
  hotkeyAvailable: () => boolean;
  version: string;
}

export class Companion {
  private state: BuddyState = 'idle';
  private brain: Brain;
  private stt: SttStatus = { kind: 'idle' };
  private lastQuestion = '';
  private lastAnswer = '';
  private error = '';

  // Per-reply state
  private turn = 0;
  private shotPromise: Promise<Screenshot | null> | null = null;
  private shot: Screenshot | null = null;
  private pendingPoints: PointTag[] = [];
  private pointsBySpeech = new Map<number, PointTag[]>();
  private speechId = 0;
  private speaking = new Set<number>();
  private streamDone = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private pointQueue: PointTag[] = [];
  private pointTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private d: CompanionDeps) {
    this.brain = new Brain(d.getKey);
  }

  // ------------------------------------------------------------ status

  status(): AppStatus {
    return {
      state: this.state,
      stt: this.stt,
      hasApiKey: this.d.hasKey(),
      hotkeyAvailable: this.d.hotkeyAvailable(),
      lastQuestion: this.lastQuestion,
      lastAnswer: this.lastAnswer,
      error: this.error,
      version: this.d.version,
    };
  }

  private setState(s: BuddyState) {
    this.state = s;
    this.d.overlays.send('overlay:state', { state: s });
    this.d.onStatus(this.status());
  }

  setSttStatus(s: SttStatus) {
    this.stt = s;
    this.d.onStatus(this.status());
  }

  private engineSend(channel: string, data?: unknown) {
    const e = this.d.engine();
    if (e && !e.isDestroyed()) e.webContents.send(channel, data);
  }

  // ------------------------------------------------------------ input

  /** Hotkey pressed: start listening (interrupting anything in progress). */
  startListening() {
    this.interrupt(false);
    this.error = '';
    this.setState('listening');
    this.engineSend('engine:record-start');
  }

  /** Hotkey released: stop recording, transcribe, and grab the screen meanwhile. */
  stopListening() {
    if (this.state !== 'listening') return;
    this.setState('transcribing');
    this.engineSend('engine:record-stop');
    // Grab the screen while speech is being transcribed. The engine replies
    // with onTranscript().
    this.shotPromise = captureCursorDisplay().catch((err) => {
      console.error('[perch] capture failed', err);
      return null;
    });
  }

  /** Hotkey cancelled (another key was pressed). */
  cancelListening() {
    if (this.state !== 'listening') return;
    this.engineSend('engine:record-cancel');
    this.setState('idle');
  }

  onTranscript(text: string, error?: string) {
    if (error && (this.state === 'listening' || this.state === 'transcribing')) {
      this.fail(error);
      return;
    }
    if (this.state !== 'transcribing') return;
    const q = text.trim();
    if (!q || /^\[?(blank_audio|silence|music)\]?$/i.test(q)) {
      this.say("I didn't catch that. Hold the keys and try again.", true);
      return;
    }
    void this.respond(q, this.shotPromise ?? captureCursorDisplay().catch(() => null));
  }

  /** Typed question from the panel. */
  askTyped(text: string) {
    const q = text.trim();
    if (!q) return;
    this.interrupt(false);
    this.error = '';
    ++this.turn;
    // Give the panel a moment to hide so it isn't in the screenshot.
    const shot = new Promise<Screenshot | null>((r) => setTimeout(r, 250)).then(() =>
      captureCursorDisplay().catch(() => null),
    );
    void this.respond(q, shot);
  }

  /** Escape or a new question: stop talking, stop thinking. */
  interrupt(goIdle = true) {
    this.brain.abort();
    this.engineSend('engine:speak-stop');
    this.speaking.clear();
    this.pointsBySpeech.clear();
    this.pendingPoints = [];
    this.clearPoints();
    this.turn++;
    if (goIdle && this.state !== 'idle') {
      if (this.state === 'listening') this.engineSend('engine:record-cancel');
      this.d.overlays.send('overlay:bubble', { text: '', done: true });
      this.setState('idle');
    }
  }

  resetConversation() {
    this.interrupt();
    this.brain.reset();
    this.lastQuestion = '';
    this.lastAnswer = '';
    this.d.onStatus(this.status());
  }

  // ------------------------------------------------------------ reply

  private async respond(question: string, shotPromise: Promise<Screenshot | null>) {
    const turn = this.turn;
    const settings = this.d.settings();
    this.lastQuestion = question;
    this.lastAnswer = '';
    this.setState('thinking');
    this.d.overlays.send('overlay:bubble', { text: '', done: false });

    if (!this.d.hasKey()) {
      this.say('I need your Claude API key first. I opened settings for you.', true);
      this.d.openPanel();
      return;
    }

    const shot = await shotPromise;
    if (turn !== this.turn) return;
    this.shot = shot;

    const tags = new TagStream();
    const chunker = new SentenceChunker();
    let display = '';
    this.streamDone = false;
    this.speaking.clear();
    this.pendingPoints = [];

    const handle = (events: ReturnType<TagStream['push']>, final: boolean) => {
      for (const ev of events) {
        if (ev.type === 'point') {
          if (settings.speakReplies) this.pendingPoints.push(ev.point);
          else this.queuePoint(ev.point);
        } else {
          display += ev.text;
          if (settings.speakReplies) for (const s of chunker.push(ev.text)) this.speakSentence(s);
        }
      }
      if (final && settings.speakReplies) {
        for (const s of chunker.end()) this.speakSentence(s);
        if (this.pendingPoints.length) {
          // Points after the last sentence: show them now.
          for (const p of this.pendingPoints) this.queuePoint(p);
          this.pendingPoints = [];
        }
      }
      this.d.overlays.send('overlay:bubble', { text: display.trim(), done: final });
    };

    try {
      await this.brain.ask(
        question,
        shot,
        { model: settings.model, effort: settings.effort },
        {
          onText: (delta) => {
            if (turn !== this.turn) return;
            if (this.state === 'thinking') this.setState('speaking');
            handle(tags.push(delta), false);
          },
        },
      );
      if (turn !== this.turn) return;
      handle(tags.end(), true);
      this.lastAnswer = display.trim();
      this.streamDone = true;
      if (this.state === 'thinking') this.setState('speaking');
      this.d.onStatus(this.status());
      this.maybeFinish();
    } catch (err) {
      if (turn !== this.turn) return;
      const msg = friendlyError(err);
      if (!msg) return; // aborted
      console.error('[perch] Claude error', err);
      this.fail(msg);
    }
  }

  private speakSentence(text: string) {
    const spoken = cleanForSpeech(text);
    const id = ++this.speechId;
    this.pointsBySpeech.set(id, this.pendingPoints);
    this.pendingPoints = [];
    if (!spoken) {
      // Nothing to say (e.g. only symbols) but keep its points.
      for (const p of this.pointsBySpeech.get(id) ?? []) this.queuePoint(p);
      this.pointsBySpeech.delete(id);
      return;
    }
    this.speaking.add(id);
    const s = this.d.settings();
    this.engineSend('engine:speak', {
      id,
      text: spoken,
      voiceName: s.voiceName,
      rate: s.speechRate,
    } as SpeakItem & { voiceName: string; rate: number });
  }

  /** Engine started speaking a sentence: show its points now. */
  onUtteranceStart(id: number) {
    const pts = this.pointsBySpeech.get(id);
    if (pts?.length) for (const p of pts) this.queuePoint(p);
    this.pointsBySpeech.delete(id);
  }

  onUtteranceEnd(id: number) {
    this.speaking.delete(id);
    // If speech failed before it started, still show the sentence's points.
    const pts = this.pointsBySpeech.get(id);
    if (pts?.length) for (const p of pts) this.queuePoint(p);
    this.pointsBySpeech.delete(id);
    this.maybeFinish();
  }

  private maybeFinish() {
    if (!this.streamDone || this.speaking.size) return;
    if (this.state !== 'speaking' && this.state !== 'error') return;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    const turn = this.turn;
    this.releaseTimer = setTimeout(() => {
      if (turn !== this.turn) return;
      this.clearPoints();
      this.d.overlays.send('overlay:bubble', { text: '', done: true });
      this.setState('idle');
    }, RELEASE_AFTER_MS + this.pointQueue.length * POINT_DWELL_MS);
  }

  /** Short message from the buddy itself (errors, hints). */
  private say(text: string, speak: boolean) {
    this.streamDone = true;
    this.setState('speaking');
    this.d.overlays.send('overlay:bubble', { text, done: true });
    if (speak && this.d.settings().speakReplies) this.speakSentence(text);
    this.maybeFinish();
  }

  private fail(message: string) {
    this.error = message;
    this.setState('error');
    this.say(message, true);
    this.state = 'error';
    this.d.overlays.send('overlay:state', { state: 'error' });
  }

  // ------------------------------------------------------------ pointing

  private queuePoint(p: PointTag) {
    this.pointQueue.push(p);
    if (!this.pointTimer) this.nextPoint();
  }

  private nextPoint() {
    const p = this.pointQueue.shift();
    if (!p) {
      this.pointTimer = null;
      return;
    }
    this.showPoint(p);
    this.pointTimer = setTimeout(() => this.nextPoint(), POINT_DWELL_MS);
  }

  private showPoint(p: PointTag) {
    const shot = this.shot;
    if (!shot) return;
    const local = toDisplayLocal(shot, p.x, p.y);
    const msg: PointMsg = { x: local.x, y: local.y, label: p.label };
    for (const [d] of this.d.overlays.entries()) {
      if (d.id === shot.display.id) this.d.overlays.sendTo(d.id, 'overlay:point', msg);
      else this.d.overlays.sendTo(d.id, 'overlay:release');
    }
  }

  private clearPoints() {
    if (this.pointTimer) clearTimeout(this.pointTimer);
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.pointTimer = null;
    this.releaseTimer = null;
    this.pointQueue = [];
    this.d.overlays.send('overlay:release');
  }

  // ------------------------------------------------------------ cursor

  private lastCursor = { x: NaN, y: NaN, display: -1 };

  /** Called ~60 times a second: tells each overlay where the cursor is. */
  tickCursor() {
    const p = screen.getCursorScreenPoint();
    if (p.x === this.lastCursor.x && p.y === this.lastCursor.y) return;
    const display = screen.getDisplayNearestPoint(p);
    const changedDisplay = display.id !== this.lastCursor.display;
    this.lastCursor = { x: p.x, y: p.y, display: display.id };
    for (const [d] of this.d.overlays.entries()) {
      if (d.id === display.id) {
        this.d.overlays.sendTo(d.id, 'overlay:cursor', {
          x: p.x - d.bounds.x,
          y: p.y - d.bounds.y,
          visible: true,
        });
      } else if (changedDisplay) {
        this.d.overlays.sendTo(d.id, 'overlay:cursor', { x: 0, y: 0, visible: false });
      }
    }
  }

  forceCursorRefresh() {
    this.lastCursor = { x: NaN, y: NaN, display: -1 };
  }

  currentState() {
    return this.state;
  }
}
