// Talks to Claude: sends the question plus a screenshot, streams the reply back.
import Anthropic from '@anthropic-ai/sdk';
import type { Screenshot } from './capture';
import type { Effort } from '../shared/types';

const MAX_TURNS_KEPT = 8;

function systemPrompt(shot: Screenshot | null) {
  const screenPart = shot
    ? `With each message you get a screenshot of the user's current screen. It is ${shot.width}×${shot.height} pixels, origin at the top-left. The user's mouse cursor is at (${shot.cursor.x}, ${shot.cursor.y}).

You can point at things on the screen. To point, write a tag exactly like [POINT:x,y:short label] where x and y are pixel coordinates in the screenshot. Put the tag right before the sentence that talks about that thing, and Perch will fly over to it while that sentence is spoken. Point whenever showing the location helps (where to click, which button, where an error is). Use at most three points in a reply, and only point at things you can actually see in the screenshot. Never read out coordinates or mention the tag.`
    : `No screenshot is available for this message, so answer without referring to the screen.`;

  return `You are Perch, a friendly AI buddy that sits next to the user's mouse cursor on their Windows PC. The user talks to you by voice (their words were transcribed automatically, so allow for small transcription mistakes).

${screenPart}

Your replies are spoken aloud and shown in a small speech bubble, so:
- Talk like a helpful friend sitting beside them. Keep it short: one to three sentences, unless they ask for more detail or for step-by-step help.
- Write plain spoken sentences. No markdown, bullet lists, headings, code blocks or emoji. Spell out keyboard shortcuts naturally, like "press Control plus S".
- If they ask for steps, give one or two steps at a time, then offer to continue.
- If the request is unclear or the transcription looks garbled, briefly ask them to say it again.
- Be honest when you can't tell something from the screenshot.`;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskCallbacks {
  onText(delta: string): void;
}

export class Brain {
  private history: Turn[] = [];
  private controller: AbortController | null = null;

  constructor(private getKey: () => string | null) {}

  reset() {
    this.history = [];
  }

  abort() {
    this.controller?.abort();
    this.controller = null;
  }

  async ask(
    question: string,
    shot: Screenshot | null,
    opts: { model: string; effort: Effort },
    cb: AskCallbacks,
  ): Promise<string> {
    const apiKey = this.getKey();
    if (!apiKey) throw new Error('NO_API_KEY');

    this.abort();
    const controller = new AbortController();
    this.controller = controller;

    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });

    const past: Anthropic.MessageParam[] = this.history.map((t) => ({ role: t.role, content: t.text }));
    const content: Anthropic.ContentBlockParam[] = [];
    if (shot) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: shot.data },
      });
    }
    content.push({ type: 'text', text: question });

    let full = '';
    const stream = client.messages.stream(
      {
        model: opts.model,
        max_tokens: 1024,
        system: systemPrompt(shot),
        messages: [...past, { role: 'user', content }],
        output_config: { effort: opts.effort },
      },
      { signal: controller.signal },
    );

    stream.on('text', (delta: string) => {
      full += delta;
      cb.onText(delta);
    });

    await stream.finalMessage();
    if (this.controller === controller) this.controller = null;

    this.history.push({ role: 'user', text: question }, { role: 'assistant', text: full || '(no reply)' });
    if (this.history.length > MAX_TURNS_KEPT * 2) {
      this.history = this.history.slice(-MAX_TURNS_KEPT * 2);
    }
    return full;
  }
}

/** Turns API errors into a short sentence the buddy can say. */
export function friendlyError(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string };
  if (e?.message === 'NO_API_KEY') return 'I need your Claude API key first. Open Perch from the tray to add it.';
  if (e?.name === 'AbortError' || e?.name === 'APIUserAbortError') return '';
  switch (e?.status) {
    case 401:
      return 'That API key was rejected. Check it in Perch settings.';
    case 403:
      return "Your API key doesn't have access to that model.";
    case 404:
      return "That model wasn't found. Pick another one in settings.";
    case 429:
      return "I'm being rate limited right now. Try again in a moment.";
    case 529:
    case 500:
    case 503:
      return 'Claude is busy at the moment. Try again shortly.';
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|network/i.test(e?.message ?? '')) {
    return "I can't reach Claude. Check your internet connection.";
  }
  return 'Something went wrong talking to Claude.';
}
