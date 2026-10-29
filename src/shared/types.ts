// Types shared by the main process and the renderer pages.

export type BuddyState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type HotkeyCombo = 'ctrl+alt' | 'ctrl+win' | 'ctrl+shift';

export type Effort = 'low' | 'medium' | 'high';

export type WhisperModel =
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-small';

export interface Settings {
  model: string;
  effort: Effort;
  hotkey: HotkeyCombo;
  whisperModel: WhisperModel;
  speakReplies: boolean;
  voiceName: string; // '' = system default
  speechRate: number; // 0.5 – 2
  showWhenIdle: boolean;
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-sonnet-5-5',
  effort: 'low',
  hotkey: 'ctrl+alt',
  whisperModel: 'Xenova/whisper-base.en',
  speakReplies: true,
  voiceName: '',
  speechRate: 1.05,
  showWhenIdle: true,
  launchAtLogin: false,
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
  hasApiKey: boolean;
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
