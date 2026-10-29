// Settings live in a small JSON file in the app's user-data folder. The Claude
// API key is stored separately, encrypted with Electron's safeStorage (which
// uses Windows DPAPI, so only this Windows user account can decrypt it).
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

const dir = () => app.getPath('userData');
const settingsFile = () => join(dir(), 'settings.json');
const keyFile = () => join(dir(), 'claude-key.bin');

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    cache = { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache!;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings() };
  // Only accept known keys with the right type.
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k in patch && typeof patch[k] === typeof DEFAULT_SETTINGS[k]) {
      (next as any)[k] = patch[k];
    }
  }
  next.speechRate = Math.min(2, Math.max(0.5, next.speechRate));
  cache = next;
  mkdirSync(dir(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

export function hasApiKey(): boolean {
  return existsSync(keyFile()) || !!process.env.ANTHROPIC_API_KEY;
}

export function getApiKey(): string | null {
  if (existsSync(keyFile())) {
    try {
      return safeStorage.decryptString(readFileSync(keyFile()));
    } catch {
      return null;
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('The API key is empty.');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system, so the key was not saved.');
  }
  mkdirSync(dir(), { recursive: true });
  writeFileSync(keyFile(), safeStorage.encryptString(trimmed));
}

export function clearApiKey(): void {
  if (existsSync(keyFile())) unlinkSync(keyFile());
}
