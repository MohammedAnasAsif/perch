// The companion's brain stem: wires hotkey -> microphone -> transcript ->
// screenshot + AI -> speech bubble, voice and pointing. Requests that start
// with "agent" go to agent mode instead.
import { screen, type BrowserWindow } from 'electron';
import { Brain, toShotPixels } from './brain';
import { currentAi, friendlyAiError } from './ai';
import type { CoordSpace } from './ai/types';
import { Agent } from './agent/agent';
import { looksLikeActionRequest, parseAgentCommand } from './agent/actions';
import type { WindowsInput } from './agent/input';
import { captureCursorDisplay, toDisplayLocal, type Display, type Screenshot } from './capture';
import { gatherContext } from './context';
import { remember } from './store';
import { addReminder } from './reminders';
import { TagStream, SentenceChunker, cleanForSpeech, type PointTag } from '../shared/stream';
import type { Overlays } from './windows';
import type { AppStatus, BuddyState, PointMsg, Settings, SpeakItem, SttStatus } from '../shared/types';

const RELEASE_AFTER_MS = 2500; // buddy returns to the cursor this long after speaking
const POINT_DWELL_MS = 1600; // when not speaking, how long each point is shown

export interface CompanionDeps {
  overlays: Overlays;
  engine: () => BrowserWindow | null;
  settings: () => Settings;
  aiReady: () => boolean;
  keys: () => AppStatus['keys'];
  input: WindowsInput;
  approve: (text: string, near: { x: number; y: number }, signal: AbortSignal) => Promise<boolean>;
  suppressHotkeys: (ms: number) => void;
  /** Memory or reminders changed (refresh the panel lists). */
  onNotesChanged: () => void;
  onStatus: (s: AppStatus) => void;
  updateStatus: () => AppStatus['update'];
  openPanel: () => void;
  hotkeyAvailable: () => boolean;
  version: string;
}

export class Companion {
  private state: BuddyState = 'idle';
  private brain: Brain;
  private stt: SttStatus = { kind: 'idle' };
  private tts: SttStatus = { kind: 'idle' };
  private lastQuestion = '';
  private lastAnswer = '';
  private error = '';
  private agent: Agent;
  private agentAbort: AbortController | null = null;
  private agentStep = '';

  // Per-reply state
  private turn = 0;
  private shotPromise: Promise<Screenshot | null> | null = null;
  private shot: Screenshot | null = null;
  private space: CoordSpace = 'pixels';
  private pendingPoints: PointTag[] = [];
  private pointsBySpeech = new Map<number, PointTag[]>();
  private speechId = 0;
  private speaking = new Set<number>();
  private streamDone = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private pointQueue: PointTag[] = [];
  private pointTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private d: CompanionDeps) {
    this.brain = new Brain();
    this.agent = new Agent({
      input: d.input,
      settings: d.settings,
      onStep: (text) => this.setAgentStep(text),
      point: (display, p) => this.agentPoint(display, p),
      approve: d.approve,
      suppressHotkeys: d.suppressHotkeys,
    });
  }

  // ------------------------------------------------------------ status

  status(): AppStatus {
    return {
      state: this.state,
      stt: this.stt,
      tts: this.tts,
      update: this.d.updateStatus(),
      provider: this.d.settings().provider,
      keys: this.d.keys(),
      aiReady: this.d.aiReady(),
      agentStep: this.agentStep,
      hotkeyAvailable: this.d.hotkeyAvailable(),
      lastQuestion: this.lastQuestion,
      lastAnswer: this.lastAnswer,
      error: this.error,
      version: this.d.version,
    };
  }

  private announcements: string[] = [];

  /** Says something unprompted (e.g. a reminder) as soon as Perch is free. */
  announce(text: string) {
    this.announcements.push(text);
    this.flushAnnouncements();
  }

  private flushAnnouncements() {
    if (!this.announcements.length) return;
    if (this.state !== 'idle' && this.state !== 'error') return;
    const text = this.announcements.shift()!;
    this.lastAnswer = text;
    this.say(text, true);
  }

  /** Pushes a fresh status to the panel (e.g. after an update event). */
  refreshStatus() {
    this.d.onStatus(this.status());
  }

  private setState(s: BuddyState) {
    this.state = s;
    this.d.overlays.send('overlay:state', { state: s });
    this.d.onStatus(this.status());
    if (s === 'idle' && this.announcements.length) setTimeout(() => this.flushAnnouncements(), 400);
  }

  setSttStatus(s: SttStatus) {
    this.stt = s;
    this.d.onStatus(this.status());
  }

  setTtsStatus(s: SttStatus) {
    this.tts = s;
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

  /** "Hey Perch" heard. With command=false, Perch listens for the request next. */
  onWake(text: string, command: boolean) {
    if (!command) {
      this.interrupt(false);
      this.error = '';
      this.setState('listening');
      return;
    }
    if (!text.trim()) {
      if (this.state === 'listening') this.setState('idle');
      return;
    }
    this.interrupt(false);
    this.error = '';
    this.setState('transcribing');
    this.shotPromise = captureCursorDisplay().catch(() => null);
    this.onTranscript(text);
  }

  /** Woke up but no request followed. */
  onWakeTimeout() {
    if (this.state === 'listening') this.setState('idle');
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
    const shotPromise = this.shotPromise ?? captureCursorDisplay().catch(() => null);
    const task = parseAgentCommand(q) ?? looksLikeActionRequest(q);
    console.log(`[perch] heard: "${q}" -> ${task ? 'agent' : 'chat'}`);
    if (task) void this.runAgent(q, task, shotPromise.then((s) => s?.display ?? null));
    else void this.respond(q, shotPromise);
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
    const task = parseAgentCommand(q) ?? looksLikeActionRequest(q);
    console.log(`[perch] typed: "${q}" -> ${task ? 'agent' : 'chat'}`);
    if (task) void this.runAgent(q, task, shot.then((s) => s?.display ?? null));
    else void this.respond(q, shot);
  }

  /** Escape or a new question: stop talking, stop thinking. */
  interrupt(goIdle = true) {
    this.brain.abort();
    this.agentAbort?.abort();
    this.agentAbort = null;
    this.setAgentStep('');
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

    if (!this.d.aiReady()) {
      this.say(friendlyAiError(new Error('NO_KEY'), settings.provider), true);
      this.d.openPanel();
      return;
    }

    const [shot, extra] = await Promise.all([
      shotPromise,
      gatherContext(question, this.d.input, this.d.suppressHotkeys),
    ]);
    if (turn !== this.turn) return;
    this.shot = shot;

    const tags = new TagStream();
    const chunker = new SentenceChunker();
    let display = '';
    let handoff = false;
    this.streamDone = false;
    this.speaking.clear();
    this.pendingPoints = [];

    const handle = (events: ReturnType<TagStream['push']>, final: boolean) => {
      for (const ev of events) {
        if (ev.type === 'agent') {
          handoff = true;
          return;
        }
        if (ev.type === 'remember') {
          if (settings.memoryEnabled && remember(ev.text)) {
            console.log('[perch] remembered:', ev.text);
            this.d.onNotesChanged();
          }
          continue;
        }
        if (ev.type === 'remind') {
          const r = addReminder(ev.body);
          if (!r.ok) {
            console.warn('[perch] reminder not set:', r.error, ev.body);
            display += ` (I couldn't set that reminder: ${r.error}.)`;
          }
          continue;
        }
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
      this.d.overlays.send('overlay:bubble', { text: display.replace(/ {2,}/g, ' ').trim(), done: final });
    };

    try {
      // Pointing needs to know the model's coordinate convention up front.
      this.space = currentAi(settings).coordSpace;
      await this.brain.ask(question + extra, shot, {
        onText: (delta) => {
          if (turn !== this.turn || handoff) return;
          const events = tags.push(delta);
          if (events.some((e) => e.type === 'agent')) {
            // The model wants agent mode to do this: switch over.
            handoff = true;
            console.log('[perch] chat handed the request to agent mode:', question);
            this.engineSend('engine:speak-stop');
            this.speaking.clear();
            this.pointsBySpeech.clear();
            this.brain.abort();
            void this.runAgent(question, question, Promise.resolve(shot?.display ?? null), turn);
            return;
          }
          if (this.state === 'thinking' && events.some((e) => e.type === 'text' && e.text.trim())) {
            this.setState('speaking');
          }
          handle(events, false);
        },
      });
      if (turn !== this.turn || handoff) return;
      handle(tags.end(), true);
      this.lastAnswer = display.replace(/ {2,}/g, ' ').trim();
      this.streamDone = true;
      if (this.state === 'thinking') this.setState('speaking');
      this.d.onStatus(this.status());
      this.maybeFinish();
    } catch (err) {
      if (turn !== this.turn || handoff) return;
      const msg = friendlyAiError(err, settings.provider);
      if (!msg) return; // aborted
      console.error('[perch] AI error', err);
      this.fail(msg);
      if (/API key/.test(msg)) this.d.openPanel();
    }
  }

  // ------------------------------------------------------------ agent

  private setAgentStep(text: string) {
    this.agentStep = text;
    this.d.overlays.send('overlay:pill', { text });
    this.d.onStatus(this.status());
  }

  private agentPoint(display: Display, p: { x: number; y: number; label: string } | null) {
    for (const [d] of this.d.overlays.entries()) {
      if (p && d.id === display.id) this.d.overlays.sendTo(d.id, 'overlay:point', p);
      else this.d.overlays.sendTo(d.id, 'overlay:release');
    }
  }

  private async runAgent(question: string, task: string, displayPromise: Promise<Display | null>, fromTurn?: number) {
    // A hand-off from chat continues the same turn.
    if (fromTurn !== undefined && fromTurn !== this.turn) return;
    const turn = this.turn;
    const settings = this.d.settings();
    this.lastQuestion = question;
    this.lastAnswer = '';
    if (!this.d.aiReady()) {
      this.say(friendlyAiError(new Error('NO_KEY'), settings.provider), true);
      this.d.openPanel();
      return;
    }
    const [maybeDisplay, extra] = await Promise.all([
      displayPromise,
      gatherContext(question, this.d.input, this.d.suppressHotkeys),
    ]);
    const display = maybeDisplay ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (turn !== this.turn) return;
    task += extra;

    const abort = new AbortController();
    this.agentAbort = abort;
    this.setState('working');
    this.setAgentStep('Getting started');
    this.d.overlays.send('overlay:bubble', { text: '', done: false });
    if (settings.speakReplies) {
      this.engineSend('engine:speak', { id: -1, text: 'On it.', voiceName: settings.voiceName, rate: settings.speechRate });
    }

    try {
      const result = await this.agent.run(task, display, abort.signal);
      if (turn !== this.turn) return;
      this.agentAbort = null;
      this.setAgentStep('');
      this.clearPoints();
      this.lastAnswer = result.summary;
      this.brain.remember(question, result.summary);
      this.say(result.summary, true);
    } catch (err) {
      if (turn !== this.turn) return;
      this.agentAbort = null;
      this.setAgentStep('');
      this.clearPoints();
      if ((err as any)?.declined) {
        this.lastAnswer = 'Stopped at your request.';
        this.say('Okay, I stopped there.', true);
        return;
      }
      const msg = friendlyAiError(err, settings.provider);
      if (!msg) return; // stopped with Escape or a new question
      console.error('[perch] agent error', err);
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
    const toLocal = (x: number, y: number) => {
      const px = toShotPixels(shot, this.space, x, y);
      return toDisplayLocal(shot, px.x, px.y);
    };
    const local = toLocal(p.x, p.y);
    const msg: PointMsg = { x: local.x, y: local.y, label: p.label };
    // Sizes scale like coordinates (model space -> screenshot pixels -> display DIPs).
    const sx = (shot.display.bounds.width / shot.width) * (this.space === 'pixels' ? 1 : shot.width / 1000);
    const sy = (shot.display.bounds.height / shot.height) * (this.space === 'pixels' ? 1 : shot.height / 1000);
    if (p.shape?.kind === 'circle') msg.shape = { kind: 'circle', r: Math.max(12, p.shape.r * Math.min(sx, sy)) };
    if (p.shape?.kind === 'box') msg.shape = { kind: 'box', w: p.shape.w * sx, h: p.shape.h * sy };
    if (p.shape?.kind === 'arrow') {
      const from = toLocal(p.shape.fromX, p.shape.fromY);
      msg.shape = { kind: 'arrow', fromX: from.x, fromY: from.y };
    }
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
