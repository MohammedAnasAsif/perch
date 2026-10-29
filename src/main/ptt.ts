// Push-to-talk state machine. Pure logic (no native hooks) so it can be tested.
//
// Hold the combo (e.g. Ctrl+Alt) to talk, release to send. If any other key is
// pressed while the combo is held, it was a normal shortcut (or AltGr typing),
// so we stay out of the way.
import type { HotkeyCombo } from '../shared/types';

// libuiohook key codes
export const KEY = {
  Escape: 1,
  Ctrl: 29,
  CtrlRight: 3613,
  Alt: 56,
  AltRight: 3640,
  Shift: 42,
  ShiftRight: 54,
  Meta: 3675,
  MetaRight: 3676,
} as const;

const GROUPS: Record<string, number[]> = {
  ctrl: [KEY.Ctrl, KEY.CtrlRight],
  alt: [KEY.Alt, KEY.AltRight],
  shift: [KEY.Shift, KEY.ShiftRight],
  win: [KEY.Meta, KEY.MetaRight],
};

export interface PttEvents {
  onStart(): void;
  onStop(): void;
  onCancel(): void;
  onEscape(): void;
}

export class PushToTalk {
  private down = new Set<number>();
  private groups: number[][];
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private spoiled = false; // another key was pressed during this hold

  constructor(
    combo: HotkeyCombo,
    private ev: PttEvents,
    private holdMs = 180,
  ) {
    this.groups = combo.split('+').map((g) => GROUPS[g]);
  }

  setCombo(combo: HotkeyCombo) {
    this.reset();
    this.groups = combo.split('+').map((g) => GROUPS[g]);
  }

  private isComboKey(code: number) {
    return this.groups.some((g) => g.includes(code));
  }

  private comboHeld() {
    return this.groups.every((g) => g.some((k) => this.down.has(k)));
  }

  keydown(code: number) {
    if (code === KEY.Escape) this.ev.onEscape();
    const repeat = this.down.has(code);
    this.down.add(code);
    if (repeat) return;

    if (!this.isComboKey(code)) {
      if (this.comboHeld() || this.armTimer || this.active) {
        this.spoiled = true;
        this.disarm();
        if (this.active) {
          this.active = false;
          this.ev.onCancel();
        }
      }
      return;
    }

    if (this.comboHeld() && !this.active && !this.spoiled && this.onlyComboKeysDown()) {
      this.disarm();
      this.armTimer = setTimeout(() => {
        this.armTimer = null;
        if (this.comboHeld() && !this.spoiled) {
          this.active = true;
          this.ev.onStart();
        }
      }, this.holdMs);
    }
  }

  keyup(code: number) {
    this.down.delete(code);
    if (this.isComboKey(code)) {
      this.disarm();
      if (this.active) {
        this.active = false;
        this.ev.onStop();
      }
    }
    if (!this.groups.some((g) => g.some((k) => this.down.has(k)))) {
      // All combo keys released: next hold starts fresh.
      this.spoiled = false;
    }
  }

  private onlyComboKeysDown() {
    for (const k of this.down) if (!this.isComboKey(k)) return false;
    return true;
  }

  private disarm() {
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
  }

  reset() {
    this.disarm();
    this.down.clear();
    this.active = false;
    this.spoiled = false;
  }
}
