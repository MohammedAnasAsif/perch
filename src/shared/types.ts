// Types shared by the main process and the renderer pages.

export type BuddyState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'working' // agent mode is running
  | 'error';

export type ProviderId = 'claude' | 'gemini' | 'ollama';
export type AgentConfirm = 'risky' | 'every';

export type HotkeyCombo = 'ctrl+alt' | 'ctrl+win' | 'ctrl+shift';

export type Effort = 'low' | 'medium' | 'high';

export type WhisperModel =
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-small';

export interface Settings {
  provider: ProviderId;
  claudeModel: string;
  geminiModel: string;
  ollamaModel: string;
  ollamaUrl: string;
  effort: Effort;
  hotkey: HotkeyCombo;
  whisperModel: WhisperModel;
  speakReplies: boolean;
  voiceName: string; // '' = system default
  speechRate: number; // 0.5 – 2
  showWhenIdle: boolean;
  launchAtLogin: boolean;
  /** Agent mode may move the mouse and type. */
  agentControl: boolean;
  agentConfirm: AgentConfirm;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  claudeModel: 'claude-sonnet-5-5',
  geminiModel: 'gemini-flash-latest',
  ollamaModel: 'qwen3-vl:8b',
  ollamaUrl: 'http://127.0.0.1:11434',
  effort: 'low',
  hotkey: 'ctrl+alt',
  whisperModel: 'Xenova/whisper-base.en',
  speakReplies: true,
  voiceName: '',
  speechRate: 1.05,
  showWhenIdle: true,
  launchAtLogin: false,
  agentControl: true,
  agentConfirm: 'risky',
};

export type SttStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number; file?: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** Everything the settings panel needs to draw itself. */
export interface AppStatus {
  state: BuddyState;
  stt: SttStatus;
  provider: ProviderId;
  /** Which providers have a saved key. */
  keys: Record<'claude' | 'gemini', boolean>;
  /** The selected AI is set up (has a key, or is local). */
  aiReady: boolean;
  /** Agent progress line while working. */
  agentStep: string;
  hotkeyAvailable: boolean;
  lastQuestion: string;
  lastAnswer: string;
  error: string;
  version: string;
}

// ----- Overlay messages (main -> overlay) -----
export interface CursorMsg {
  x: number;
  y: number;
  visible: boolean;
}
export interface StateMsg {
  state: BuddyState;
}
export interface BubbleMsg {
  text: string;
  /** true once the reply is complete */
  done: boolean;
}
export interface PointMsg {
  x: number;
  y: number;
  label: string;
}

// ----- Engine messages -----
export interface SpeakItem {
  id: number;
  text: string;
}
export interface TranscriptMsg {
  text: string;
  error?: string;
}
