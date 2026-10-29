// Keeps agent conversations small: the task, the latest exchanges, and only
// the newest screenshot. Pure logic so it can be tested.
import type { ChatMessage } from '../ai/types';

const KEEP_MESSAGES = 16;

/** Keeps the task message plus the most recent exchanges, with only the newest screenshot. */
export function trimHistory(history: ChatMessage[], keep = KEEP_MESSAGES): ChatMessage[] {
  const first = history[0];
  let rest = history.slice(1);
  if (rest.length > keep) rest = rest.slice(-keep);
  // Turns must alternate: after the task (a user turn) the rest starts with an assistant turn.
  if (rest[0]?.role === 'user') rest = rest.slice(1);
  const msgs = [first, ...rest];
  const lastImage = msgs.map((m) => !!m.image).lastIndexOf(true);
  return msgs.map((m, i) => (m.image && i !== lastImage ? { role: m.role, text: m.text + '\n(older screenshot removed)' } : m));
}
