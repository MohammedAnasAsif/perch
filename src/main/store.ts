// Small JSON-file stores for memories and reminders, kept in Perch's
// user-data folder (only on this PC).
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

class JsonList<T extends { id: string }> {
  private items: T[] | null = null;
  constructor(
    private file: string,
    private max: number,
  ) {}

  private path() {
    return join(app.getPath('userData'), this.file);
  }

  all(): T[] {
    if (this.items) return this.items;
    try {
      this.items = existsSync(this.path()) ? (JSON.parse(readFileSync(this.path(), 'utf8')) as T[]) : [];
      if (!Array.isArray(this.items)) this.items = [];
    } catch {
      this.items = [];
    }
    return this.items;
  }

  protected save() {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    const tmp = this.path() + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.items ?? [], null, 2));
    renameSync(tmp, this.path()); // atomic replace
  }

  add(item: Omit<T, 'id'>): T {
    const full = { ...item, id: randomUUID() } as T;
    const items = this.all();
    items.push(full);
    while (items.length > this.max) items.shift();
    this.save();
    return full;
  }

  update(id: string, patch: Partial<T>) {
    const it = this.all().find((i) => i.id === id);
    if (it) Object.assign(it, patch);
    this.save();
  }

  remove(id: string) {
    this.items = this.all().filter((i) => i.id !== id);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }
}

// ---------------------------------------------------------------- memory

export interface Memory {
  id: string;
  text: string;
  created: string;
}

export const memories = new JsonList<Memory>('memory.json', 100);

/** Adds a memory unless it's a near-duplicate of one we already have. */
export function remember(text: string): Memory | null {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (t.length < 3) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (memories.all().some((m) => norm(m.text) === norm(t))) return null;
  return memories.add({ text: t, created: new Date().toISOString() });
}

/** Lines for the AI's prompt. */
export function memoryPrompt(): string {
  const list = memories.all();
  if (!list.length) return '';
  return `Things you remember about the user (from earlier conversations):\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}

// ---------------------------------------------------------------- reminders

export interface Reminder {
  id: string;
  /** ISO date-time */
  due: string;
  text: string;
  created: string;
  done: boolean;
}

export const reminders = new JsonList<Reminder>('reminders.json', 200);
