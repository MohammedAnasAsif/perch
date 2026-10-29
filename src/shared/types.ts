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
  /** 'natural' = Kokoro (local neural voice), 'windows' = built-in Windows voices */
  voiceEngine: 'natural' | 'windows';
  naturalVoice: string;
  voiceName: string; // Windows voice, '' = system default
  speechRate: number; // 0.5 – 2
  showWhenIdle: boolean;
  launchAtLogin: boolean;
  /** Listen for "Hey Perch" (mic stays on; all local). */
  wakeWord: boolean;
  /** Remember facts about the user across conversations. */
  memoryEnabled: boolean;
  /** Agent mode may move the mouse and type. */
  agentControl: boolean;
  agentConfirm: AgentConfirm;
  /** Don't look at or act in password managers, banking pages, etc. */
  privacyGuard: boolean;
  /** Extra private apps or sites, comma-separated. */
  privateApps: string;
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
  voiceEngine: 'natural',
  naturalVoice: 'af_heart',
  voiceName: '',
  speechRate: 1.05,
  showWhenIdle: true,
  launchAtLogin: false,
  wakeWord: false,
  memoryEnabled: true,
  agentControl: true,
  agentConfirm: 'risky',
  privacyGuard: true,
  privateApps: '',
};

export type SttStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number; file?: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** Everything the settings panel needs to draw itself. */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'downloading'; version: string; progress: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

export interface AppStatus {
  state: BuddyState;
  stt: SttStatus;
  /** Natural voice download/readiness */
  tts: SttStatus;
  update: UpdateStatus;
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
  /** Optional drawing, in display-local DIPs. */
  shape?: { kind: 'circle'; r: number } | { kind: 'box'; w: number; h: number } | { kind: 'arrow'; fromX: number; fromY: number };
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

/** The better-sounding Kokoro voices (grades from the model card). */
export const NATURAL_VOICES = [
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'af_nicole', label: 'Nicole (US, female, soft)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' },
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'am_puck', label: 'Puck (US, male)' },
  { id: 'bm_george', label: 'George (UK, male)' },
  { id: 'bm_fable', label: 'Fable (UK, male)' },
];
