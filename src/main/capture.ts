// Screenshots of the display the cursor is on.
import { desktopCapturer, screen, type Display } from 'electron';
export type { Display };

export interface Screenshot {
  /** base64 JPEG */
  data: string;
  width: number;
  height: number;
  display: Display;
  /** Cursor position in screenshot pixels. */
  cursor: { x: number; y: number };
}

// Claude works best with images up to ~1.15 megapixels; larger ones are
// downscaled server-side anyway, so we send roughly that size.
const MAX_LONG_EDGE = 1440;

export async function captureCursorDisplay(): Promise<Screenshot> {
  const point = screen.getCursorScreenPoint();
  return captureDisplay(screen.getDisplayNearestPoint(point));
}

/** Screenshot of one display (the agent keeps using the display it started on). */
export async function captureDisplay(target: Display, maxLongEdge = MAX_LONG_EDGE): Promise<Screenshot> {
  // Use the current geometry in case the display changed since it was picked.
  const display = screen.getAllDisplays().find((d) => d.id === target.id) ?? screen.getPrimaryDisplay();
  const point = screen.getCursorScreenPoint();
  const { width: dw, height: dh } = display.bounds;
  const scale = Math.min(1, maxLongEdge / Math.max(dw * display.scaleFactor, dh * display.scaleFactor));
  const thumb = {
    width: Math.round(dw * display.scaleFactor * scale),
    height: Math.round(dh * display.scaleFactor * scale),
  };

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumb });
  if (!sources.length) throw new Error('Could not capture the screen.');

  let source = sources.find((s) => s.display_id === String(display.id));
  if (!source) {
    // Fallback: match by display order.
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    source = sources[idx] ?? sources[0];
  }

  const img = source.thumbnail;
  const size = img.getSize();
  if (!size.width || !size.height) throw new Error('Screen capture returned an empty image.');

  return {
    data: img.toJPEG(82).toString('base64'),
    width: size.width,
    height: size.height,
    display,
    cursor: {
      x: Math.round(((point.x - display.bounds.x) / dw) * size.width),
      y: Math.round(((point.y - display.bounds.y) / dh) * size.height),
    },
  };
}

/** Maps a point in screenshot pixels to coordinates local to the display (DIP). */
export function toDisplayLocal(shot: Screenshot, x: number, y: number) {
  const { width: dw, height: dh } = shot.display.bounds;
  return {
    x: Math.max(0, Math.min(dw, (x / shot.width) * dw)),
    y: Math.max(0, Math.min(dh, (y / shot.height) * dh)),
  };
}
