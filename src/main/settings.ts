// Settings live in a small JSON file in the app's user-data folder. The Claude
// API key is stored separately, encrypted with Electron's safeStorage (which
// uses Windows DPAPI, so only this Windows user account can decrypt it).
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

export type KeyProvider = 'claude' | 'gemini';

const dir = () => app.getPath('userData');
const settingsFile = () => join(dir(), 'settings.json');
const keyFile = (p: KeyProvider) => join(dir(), `${p}-key.bin`);
const ENV: Record<KeyProvider, string> = { claude: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    // v0.1 stored the Claude model as "model".
    if (raw.model && !raw.claudeModel) raw.claudeModel = raw.model;
    delete raw.model;
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
  if (!['claude', 'gemini', 'ollama'].includes(next.provider)) next.provider = 'claude';
  if (!['risky', 'every'].includes(next.agentConfirm)) next.agentConfirm = 'risky';
  if (!['natural', 'windows'].includes(next.voiceEngine)) next.voiceEngine = 'natural';
  if (!/^[ab][fm]_[a-z]+$/.test(next.naturalVoice)) next.naturalVoice = 'af_heart';
  if (!/^https?:\/\/[^\s]+$/.test(next.ollamaUrl)) next.ollamaUrl = DEFAULT_SETTINGS.ollamaUrl;
  next.privateApps = next.privateApps.slice(0, 2000);
  cache = next;
  mkdirSync(dir(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

export function hasApiKey(p: KeyProvider): boolean {
  return existsSync(keyFile(p)) || !!process.env[ENV[p]];
}

export function getApiKey(p: KeyProvider): string | null {
  if (existsSync(keyFile(p))) {
    try {
      return safeStorage.decryptString(readFileSync(keyFile(p)));
    } catch {
      return null;
    }
  }
  return process.env[ENV[p]] ?? null;
}

export function setApiKey(p: KeyProvider, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('The API key is empty.');
  if (p === 'claude' && !trimmed.startsWith('sk-ant-')) {
    throw new Error('That doesn\'t look like a Claude API key (they start with sk-ant-).');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system, so the key was not saved.');
  }
  mkdirSync(dir(), { recursive: true });
  writeFileSync(keyFile(p), safeStorage.encryptString(trimmed));
}

export function clearApiKey(p: KeyProvider): void {
  if (existsSync(keyFile(p))) unlinkSync(keyFile(p));
}
