// Memory notes and reminders, stored in Perch's user-data folder and encrypted
// with Windows DPAPI (safeStorage), so other accounts on the PC can't read them.
import { app, safeStorage } from 'electron';
import { JsonList, rememberIn, type Codec, type Memory } from './jsonlist';

export type { Memory };

const dpapi: Codec = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

const userData = () => app.getPath('userData');

export const memories = new JsonList<Memory>(userData, 'memory.json', 100, dpapi);

/** Adds a memory unless it's a near-duplicate or looks like a secret. */
export function remember(text: string): Memory | null {
  return rememberIn(memories, text);
}

/** Lines for the AI's prompt. */
export function memoryPrompt(): string {
  const list = memories.all();
  if (!list.length) return '';
  return `Things you remember about the user (from earlier conversations):\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}

export interface Reminder {
  id: string;
  /** ISO date-time */
  due: string;
  text: string;
  created: string;
  done: boolean;
}

export const reminders = new JsonList<Reminder>(userData, 'reminders.json', 200, dpapi);
