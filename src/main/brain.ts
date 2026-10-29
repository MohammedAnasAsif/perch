// Chat mode: sends the question plus a screenshot to the selected AI and
// streams the reply back.
import { currentAi } from './ai';
import type { ChatMessage, CoordSpace } from './ai/types';
import type { Screenshot } from './capture';
import { getSettings } from './settings';

const MAX_TURNS_KEPT = 8;

export function coordInstructions(shot: Screenshot, space: CoordSpace): { describe: string; cursor: string } {
  if (space === 'pixels') {
    return {
      describe: `x and y are pixel coordinates in the screenshot (it is ${shot.width}×${shot.height} pixels, origin at the top-left)`,
      cursor: `(${shot.cursor.x}, ${shot.cursor.y})`,
    };
  }
  const nx = Math.round((shot.cursor.x / shot.width) * 1000);
  const ny = Math.round((shot.cursor.y / shot.height) * 1000);
  return {
    describe:
      'x and y are positions on a 0–1000 scale relative to the screenshot: x=0 is the left edge and x=1000 the right edge, y=0 is the top and y=1000 the bottom',
    cursor: `(${nx}, ${ny}) on that 0–1000 scale`,
  };
}

function systemPrompt(shot: Screenshot | null, space: CoordSpace) {
  let screenPart = 'No screenshot is available for this message, so answer without referring to the screen.';
  if (shot) {
    const c = coordInstructions(shot, space);
    screenPart = `With each message you get a screenshot of the user's current screen. The user's mouse cursor is at ${c.cursor}.

You can point at things on the screen. To point, write a tag exactly like [POINT:x,y:short label], where ${c.describe}. Put the tag right before the sentence that talks about that thing, and Perch will fly over to it while that sentence is spoken. Point whenever showing the location helps (where to click, which button, where an error is). Use at most three points in a reply, and only point at things you can actually see in the screenshot. Never read out coordinates or mention the tag.`;
  }

  return `You are Perch, a friendly AI buddy that sits next to the user's mouse cursor on their Windows PC. The user talks to you by voice (their words were transcribed automatically, so allow for small transcription mistakes).

${screenPart}

Your replies are spoken aloud and shown in a small speech bubble, so:
- Talk like a helpful friend sitting beside them. Keep it short: one to three sentences, unless they ask for more detail or for step-by-step help.
- Write plain spoken sentences. No markdown, bullet lists, headings, code blocks or emoji. Spell out keyboard shortcuts naturally, like "press Control plus S".
- If they ask for steps, give one or two steps at a time, then offer to continue.
- If the request is unclear or the transcription looks garbled, briefly ask them to say it again.
- If they ask you to actually do something on the computer for them, tell them they can say "agent" before a request to have you do it.
- Be honest when you can't tell something from the screenshot.`;
}

export interface AskCallbacks {
  onText(delta: string): void;
}

export class Brain {
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private controller: AbortController | null = null;

  reset() {
    this.history = [];
  }

  abort() {
    this.controller?.abort();
    this.controller = null;
  }

  /** Remembers an exchange that happened elsewhere (e.g. an agent task). */
  remember(question: string, answer: string) {
    this.history.push({ role: 'user', text: question }, { role: 'assistant', text: answer || '(done)' });
    this.trim();
  }

  private trim() {
    if (this.history.length > MAX_TURNS_KEPT * 2) this.history = this.history.slice(-MAX_TURNS_KEPT * 2);
  }

  /** Streams a reply. Resolves with the full text and the coordinate space its tags use. */
  async ask(question: string, shot: Screenshot | null, cb: AskCallbacks): Promise<{ text: string; space: CoordSpace }> {
    this.abort();
    const controller = new AbortController();
    this.controller = controller;

    const { provider, model, coordSpace } = currentAi();
    const messages: ChatMessage[] = [
      ...this.history,
      {
        role: 'user',
        text: question,
        ...(shot ? { image: { data: shot.data, width: shot.width, height: shot.height } } : {}),
      },
    ];

    const text = await provider.stream(
      {
        system: systemPrompt(shot, coordSpace),
        messages,
        model,
        maxTokens: 1024,
        signal: controller.signal,
        effort: getSettings().effort,
      },
      cb.onText,
    );
    if (this.controller === controller) this.controller = null;

    this.history.push({ role: 'user', text: question }, { role: 'assistant', text: text || '(no reply)' });
    this.trim();
    return { text, space: coordSpace };
  }
}

/** Converts a point from the model's coordinate space to screenshot pixels. */
export function toShotPixels(shot: Screenshot, space: CoordSpace, x: number, y: number) {
  if (space === 'pixels') return { x, y };
  return { x: (x / 1000) * shot.width, y: (y / 1000) * shot.height };
}
