// Turns key names like "ctrl+shift+s" or "enter" into Windows virtual-key codes.
// Pure logic so it can be tested without Windows.

export interface VKey {
  vk: number;
  /** Needs the "extended key" flag (arrows, Home/End, Delete, …). */
  ext: boolean;
}

const NAMED: Record<string, [number, boolean?]> = {
  ctrl: [0x11],
  control: [0x11],
  shift: [0x10],
  alt: [0x12],
  win: [0x5b, true],
  windows: [0x5b, true],
  meta: [0x5b, true],
  super: [0x5b, true],
  cmd: [0x11], // models sometimes write Mac shortcuts; Ctrl is the Windows equivalent
  enter: [0x0d],
  return: [0x0d],
  esc: [0x1b],
  escape: [0x1b],
  tab: [0x09],
  space: [0x20],
  spacebar: [0x20],
  backspace: [0x08],
  delete: [0x2e, true],
  del: [0x2e, true],
  insert: [0x2d, true],
  home: [0x24, true],
  end: [0x23, true],
  pageup: [0x21, true],
  pgup: [0x21, true],
  pagedown: [0x22, true],
  pgdn: [0x22, true],
  up: [0x26, true],
  down: [0x28, true],
  left: [0x25, true],
  right: [0x27, true],
  arrowup: [0x26, true],
  arrowdown: [0x28, true],
  arrowleft: [0x25, true],
  arrowright: [0x27, true],
  capslock: [0x14],
  printscreen: [0x2c, true],
  menu: [0x5d, true],
  apps: [0x5d, true],
};

const PUNCT: Record<string, number> = {
  ';': 0xba,
  '=': 0xbb,
  ',': 0xbc,
  '-': 0xbd,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  "'": 0xde,
};

const MODIFIERS = new Set([0x11, 0x10, 0x12, 0x5b]);

function one(name: string): VKey {
  const k = name.trim().toLowerCase();
  if (!k) throw new Error('Empty key name');
  if (NAMED[k]) return { vk: NAMED[k][0], ext: !!NAMED[k][1] };
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return { vk: 0x70 + Number(k.slice(1)) - 1, ext: false };
  if (/^[a-z]$/.test(k)) return { vk: k.toUpperCase().charCodeAt(0), ext: false };
  if (/^[0-9]$/.test(k)) return { vk: k.charCodeAt(0), ext: false };
  if (k in PUNCT) return { vk: PUNCT[k], ext: false };
  throw new Error(`Unknown key "${name}"`);
}

/**
 * Parses "ctrl+shift+s", "Enter", "alt + f4" or "ctrl++" into keys, modifiers
 * first. Throws on unknown names.
 */
export function parseCombo(combo: string): VKey[] {
  const raw = combo.trim();
  if (!raw) throw new Error('Empty key combination');
  // Split on "+" but allow "+" itself as the final key (e.g. "ctrl++").
  const parts = raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '='] : raw.split('+');
  const keys = parts.filter((p) => p.trim() !== '').map(one);
  if (!keys.length) throw new Error('Empty key combination');
  const mods = keys.filter((k) => MODIFIERS.has(k.vk));
  const rest = keys.filter((k) => !MODIFIERS.has(k.vk));
  return [...mods, ...rest];
}

/** Escape pressed by the agent itself (so the global "stop" handler can ignore it). */
export function includesEscape(keys: VKey[]) {
  return keys.some((k) => k.vk === 0x1b);
}
