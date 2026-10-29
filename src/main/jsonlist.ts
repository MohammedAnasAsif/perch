// Small encrypted JSON lists on disk (memory notes, reminders). The encryption
// is passed in (Windows DPAPI in the app, a fake in tests), so this file has no
// Electron dependency and can be unit-tested.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { containsSecret } from '../shared/redact';

export interface Codec {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class JsonList<T extends { id: string }> {
  private items: T[] | null = null;

  constructor(
    private dir: () => string,
    private file: string,
    private max: number,
    private codec: Codec,
  ) {}

  private path() {
    return join(this.dir(), this.file);
  }

  all(): T[] {
    if (this.items) return this.items;
    this.items = [];
    try {
      if (!existsSync(this.path())) return this.items;
      const raw = readFileSync(this.path());
      let json: string;
      try {
        json = this.codec.decrypt(raw);
      } catch {
        // Files from v0.3 and earlier were plain JSON; they're re-saved encrypted.
        json = raw.toString('utf8');
      }
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) this.items = parsed as T[];
    } catch {
      this.items = [];
    }
    return this.items;
  }

  private save() {
    // Never fall back to writing plaintext.
    if (!this.codec.available()) return;
    mkdirSync(this.dir(), { recursive: true });
    const tmp = this.path() + '.tmp';
    writeFileSync(tmp, this.codec.encrypt(JSON.stringify(this.items ?? [])));
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

export interface Memory {
  id: string;
  text: string;
  created: string;
}

/** Adds a memory unless it's empty, a near-duplicate, or looks like a secret. */
export function rememberIn(list: JsonList<Memory>, text: string): Memory | null {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (t.length < 3) return null;
  if (containsSecret(t)) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (list.all().some((m) => norm(m.text) === norm(t))) return null;
  return list.add({ text: t, created: new Date().toISOString() });
}
