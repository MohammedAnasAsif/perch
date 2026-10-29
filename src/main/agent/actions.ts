// The agent's action format: each step the AI replies with one JSON object.
// Pure logic so it can be tested.

export type Action =
  | { type: 'click'; x: number; y: number; target: string; button: 'left' | 'right'; double: boolean; risky: boolean }
  | { type: 'type'; text: string; target: string; risky: boolean }
  | { type: 'key'; keys: string; target: string; risky: boolean }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number }
  | { type: 'open'; target: string }
  | { type: 'wait'; seconds: number }
  | { type: 'web_search'; query: string }
  | { type: 'browser_search'; query: string }
  | { type: 'read_webpage'; url: string }
  | { type: 'write_document'; title: string; content: string }
  | { type: 'ask_user'; question: string }
  | { type: 'done'; summary: string };

export interface Step {
  thought: string;
  /** Short status line for the user ("Opening Notepad"). */
  say: string;
  action: Action;
}

/** Actions that touch the mouse or keyboard. */
export const CONTROL_ACTIONS = new Set(['click', 'type', 'key', 'scroll', 'open', 'browser_search']);

/** Pulls the first complete JSON object out of a reply (models sometimes wrap it in prose or ```). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object in the reply.');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('The JSON object in the reply is incomplete.');
}

const str = (v: unknown, max = 20_000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error('A coordinate is missing or not a number.');
  return n;
};
const bool = (v: unknown) => v === true || v === 'true';

/** Validates a parsed reply into a Step. Throws with a message the model can learn from. */
export function parseStep(raw: unknown): Step {
  if (!raw || typeof raw !== 'object') throw new Error('Reply must be a JSON object.');
  const r = raw as Record<string, any>;
  const a = (r.action && typeof r.action === 'object' ? r.action : r) as Record<string, any>;
  const type = str(a.type ?? a.action).toLowerCase().replace(/[\s-]/g, '_');
  let action: Action;
  switch (type) {
    case 'click':
    case 'double_click':
    case 'right_click':
      action = {
        type: 'click',
        x: num(a.x),
        y: num(a.y),
        target: str(a.target ?? a.description, 200),
        button: type === 'right_click' || a.button === 'right' ? 'right' : 'left',
        double: type === 'double_click' || bool(a.double),
        risky: bool(a.risky),
      };
      break;
    case 'type':
      if (typeof a.text !== 'string' || !a.text) throw new Error('"type" needs a non-empty "text".');
      action = { type: 'type', text: str(a.text, 5000), target: str(a.target, 200), risky: bool(a.risky) };
      break;
    case 'key':
    case 'keys':
    case 'hotkey':
      if (!str(a.keys ?? a.key)) throw new Error('"key" needs "keys", like "ctrl+s".');
      action = { type: 'key', keys: str(a.keys ?? a.key, 60), target: str(a.target, 200), risky: bool(a.risky) };
      break;
    case 'scroll':
      action = {
        type: 'scroll',
        x: num(a.x),
        y: num(a.y),
        direction: a.direction === 'up' ? 'up' : 'down',
        amount: Math.min(15, Math.max(1, Math.round(Number(a.amount) || 5))),
      };
      break;
    case 'open':
    case 'open_app':
    case 'launch':
      if (!str(a.target ?? a.app ?? a.url)) throw new Error('"open" needs a "target" (app name or URL).');
      action = { type: 'open', target: str(a.target ?? a.app ?? a.url, 500) };
      break;
    case 'wait':
      action = { type: 'wait', seconds: Math.min(10, Math.max(0.5, Number(a.seconds) || 1)) };
      break;
    case 'web_search':
    case 'search':
      if (!str(a.query)) throw new Error('"web_search" needs a "query".');
      action = { type: 'web_search', query: str(a.query, 300) };
      break;
    case 'browser_search':
    case 'google':
      if (!str(a.query)) throw new Error('"browser_search" needs a "query".');
      action = { type: 'browser_search', query: str(a.query, 300) };
      break;
    case 'read_webpage':
    case 'read_page':
    case 'fetch':
      if (!str(a.url)) throw new Error('"read_webpage" needs a "url".');
      action = { type: 'read_webpage', url: str(a.url, 2000) };
      break;
    case 'write_document':
    case 'write':
      if (!str(a.content)) throw new Error('"write_document" needs "content".');
      action = { type: 'write_document', title: str(a.title, 120) || 'Perch notes', content: str(a.content, 100_000) };
      break;
    case 'ask_user':
    case 'ask':
      action = { type: 'ask_user', question: str(a.question ?? a.text, 500) || 'Could you tell me more?' };
      break;
    case 'done':
    case 'finish':
      action = { type: 'done', summary: str(a.summary ?? a.text ?? r.say, 2000) || 'Done.' };
      break;
    default:
      throw new Error(`Unknown action type "${type || '(missing)'}".`);
  }
  return { thought: str(r.thought, 2000), say: str(r.say, 200), action };
}

// Words that mean an action can have consequences that are hard to undo.
const RISKY_WORDS =
  /\b(send|sent|submit|post|publish|tweet|reply|buy|purchase|pay|payment|checkout|check out|order|place order|book|subscribe|donate|transfer|delete|remove|erase|trash|discard|uninstall|install|format|overwrite|replace all|confirm|accept|agree|sign out|log out|logout|share|invite|unfriend|unfollow|block|report|cancel subscription|empty)\b/i;
const SENSITIVE_TEXT = /\b(password|passcode|pin|cvv|cvc|otp|card number|iban|ssn|aadhaar|pan)\b/i;

/**
 * Does this action need the user's OK? `every` asks before any mouse/keyboard
 * action; `risky` asks only when the model flags it or it looks consequential.
 */
export function needsApproval(action: Action, policy: 'risky' | 'every'): boolean {
  if (!CONTROL_ACTIONS.has(action.type)) return false;
  if (policy === 'every') return true;
  switch (action.type) {
    case 'click':
      return action.risky || RISKY_WORDS.test(action.target);
    case 'type':
      return action.risky || SENSITIVE_TEXT.test(action.target);
    case 'key': {
      const k = action.keys.toLowerCase().replace(/\s/g, '');
      const destructive = /^(shift\+)?delete$|ctrl\+enter|alt\+f4|ctrl\+shift\+delete/.test(k);
      return action.risky || destructive || RISKY_WORDS.test(action.target);
    }
    case 'open':
      return false;
    default:
      return false;
  }
}

/** One-line, human description of an action (for the approval prompt and status). */
export function describe(action: Action): string {
  switch (action.type) {
    case 'click':
      return `${action.double ? 'Double-click' : action.button === 'right' ? 'Right-click' : 'Click'} ${action.target || 'here'}`;
    case 'type':
      return `Type "${action.text.length > 60 ? action.text.slice(0, 57) + '…' : action.text}"${action.target ? ` into ${action.target}` : ''}`;
    case 'key':
      return `Press ${action.keys}${action.target ? ` (${action.target})` : ''}`;
    case 'scroll':
      return `Scroll ${action.direction}`;
    case 'open':
      return `Open ${action.target}`;
    case 'wait':
      return 'Wait a moment';
    case 'web_search':
      return `Search the web for "${action.query}"`;
    case 'browser_search':
      return `Search Google for "${action.query}" in your browser`;
    case 'read_webpage':
      return `Read ${safeHost(action.url)}`;
    case 'write_document':
      return `Write "${action.title}"`;
    case 'ask_user':
      return 'Ask you something';
    case 'done':
      return 'Finish';
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'a web page';
  }
}

/**
 * Detects an agent request: "agent, …", "Perch agent …", "hey perch agent …".
 * Speech recognition often mishears "Perch", so a few near-misses are allowed.
 * Returns the task, or null for a normal question.
 */
export function parseAgentCommand(text: string): string | null {
  const m =
    /^\s*(?:(?:hey|ok|okay|so|um|uh|please|alright|right)[\s,.!]+)*(?:(?:perch|birch|purch|porch|perches|pearch|perj)[\s,.:!-]*)?(?:agents?|a gent|aged)\b[\s,.:;!-]*(.*)$/is.exec(
      text,
    );
  if (!m) return null;
  const task = m[1].trim();
  return task || null;
}

// Verbs that ask Perch to act rather than explain. ("find" and "show" are left
// out: "show me where the save button is" is a pointing question for chat.)
const ACTION_VERBS =
  'open|launch|start|search|google|look up|go to|visit|navigate to|click|press|type|write|create|make|draft|compose|play|pause|close|minimi[sz]e|maximi[sz]e|scroll|download|install|uninstall|delete|rename|copy|paste|send|reply|fill|book|order|turn on|turn off|switch to|bring up|pull up';

/**
 * Plain-English action requests: "open Chrome", "search for clicky",
 * "can you open a new tab…", "please type…". Questions like "how do I open…"
 * or "what does this button do" stay in chat. Returns the task or null.
 */
export function looksLikeActionRequest(text: string): string | null {
  const t = text.trim().replace(/^[\s,.!]*(?:(?:hey|ok|okay|so|um|uh|alright|right)[\s,.!]+)*(?:perch[\s,.!]+)?/i, '');
  const polite = String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|i\s+(?:want|need)\s+you\s+to\s+|go\s+(?:and\s+)?|just\s+)?`;
  const re = new RegExp(`^${polite}(?:${ACTION_VERBS})\\b`, 'i');
  return re.test(t) ? text.trim() : null;
}
