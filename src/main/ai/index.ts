// Picks the AI provider and model from settings, and turns errors into short
// sentences the buddy can say.
import { claudeProvider } from './claude';
import { geminiProvider } from './gemini';
import { ollamaProvider } from './ollama';
import { AiError, type Provider, type ProviderId } from './types';
import { getApiKey, getSettings, hasApiKey } from '../settings';
import type { Settings } from '../../shared/types';

/** Exported so integration tests can substitute a fake AI. */
export const providers: Record<ProviderId, Provider> = {
  claude: claudeProvider(() => getApiKey('claude')),
  gemini: geminiProvider(() => getApiKey('gemini')),
  ollama: ollamaProvider(() => getSettings().ollamaUrl),
};

export function currentAi(s: Settings = getSettings()) {
  const provider = providers[s.provider];
  const model = s.provider === 'claude' ? s.claudeModel : s.provider === 'gemini' ? s.geminiModel : s.ollamaModel;
  return { provider, model, coordSpace: provider.coordSpace(model) };
}

export function aiReady(s: Settings = getSettings()): boolean {
  if (s.provider === 'ollama') return true; // checked when used
  return hasApiKey(s.provider);
}

const NAMES: Record<ProviderId, string> = { claude: 'Claude', gemini: 'Gemini', ollama: 'the local AI' };

/** A short sentence for the buddy to say, or '' if the request was cancelled. */
export function friendlyAiError(err: unknown, providerId: ProviderId): string {
  const e = err as { status?: number; message?: string; name?: string };
  if (e?.name === 'AbortError' || e?.name === 'APIUserAbortError') return '';
  const name = NAMES[providerId];
  if (e?.message === 'NO_KEY') {
    return `I need your ${providerId === 'claude' ? 'Claude' : 'Gemini'} API key first. I opened settings for you.`;
  }
  if (e?.message === 'OLLAMA_UNREACHABLE') {
    return "I can't reach Ollama. Make sure it's installed and running, then try again.";
  }
  if (providerId === 'ollama' && /not found|pull/i.test(e?.message ?? '')) {
    return `That local model isn't installed yet. Run "ollama pull ${getSettings().ollamaModel}" first.`;
  }
  switch (e?.status) {
    case 400:
      if (/api key/i.test(e?.message ?? '')) return `That ${name} API key was rejected. Check it in Perch settings.`;
      return `${name} couldn't handle that request.`;
    case 401:
    case 403:
      return `That ${name} API key was rejected or can't use this model. Check it in Perch settings.`;
    case 404:
      return "That model wasn't found. Pick another one in settings.";
    case 429:
      return providerId === 'gemini'
        ? "I've hit Gemini's free limit for now. Try again later, or pick Flash-Lite in settings."
        : `${name} is rate limiting me. Try again in a moment.`;
    case 500:
    case 503:
    case 529:
      return `${name} is busy at the moment. Try again shortly.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|network|timed? ?out/i.test(e?.message ?? '')) {
    return providerId === 'ollama'
      ? 'The local AI stopped responding. It may still be loading; try again in a moment.'
      : `I can't reach ${name}. Check your internet connection.`;
  }
  if (err instanceof AiError) console.error('[perch] AI error', providerId, err.status, err.message);
  return `Something went wrong talking to ${name}.`;
}
