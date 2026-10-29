// Global push-to-talk. Uses libuiohook (via uiohook-napi) because Electron's
// globalShortcut only reports key presses, not releases. If the native hook
// can't load, falls back to a press-to-start / press-to-stop shortcut.
import { globalShortcut } from 'electron';
import { PushToTalk, type PttEvents } from './ptt';
import type { HotkeyCombo } from '../shared/types';

export const FALLBACK_SHORTCUT = 'Control+Alt+Space';

export class Hotkey {
  private ptt: PushToTalk;
  private hook: any = null;
  available = false;
  private toggledOn = false;

  constructor(combo: HotkeyCombo, private ev: PttEvents) {
    this.ptt = new PushToTalk(combo, ev);
  }

  start() {
    try {
      // Loaded lazily so a missing native binary doesn't crash the app.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { uIOhook } = require('uiohook-napi');
      uIOhook.on('keydown', (e: { keycode: number }) => this.ptt.keydown(e.keycode));
      uIOhook.on('keyup', (e: { keycode: number }) => this.ptt.keyup(e.keycode));
      uIOhook.start();
      this.hook = uIOhook;
      this.available = true;
    } catch (err) {
      console.error('[perch] keyboard hook unavailable, using fallback shortcut', err);
      this.available = false;
      globalShortcut.register(FALLBACK_SHORTCUT, () => {
        this.toggledOn = !this.toggledOn;
        if (this.toggledOn) this.ev.onStart();
        else this.ev.onStop();
      });
    }
  }

  setCombo(combo: HotkeyCombo) {
    this.ptt.setCombo(combo);
  }

  /** Call when a recording ends for reasons other than the key (e.g. Escape). */
  resetToggle() {
    this.toggledOn = false;
  }

  stop() {
    try {
      this.hook?.stop();
    } catch {
      /* ignore */
    }
    globalShortcut.unregisterAll();
  }
}
