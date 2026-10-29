// Parsing reminder tags written by the AI: [REMIND:2026-10-29T17:00|Send the report]
// or relative ones like [REMIND:+15m|Check the oven]. Pure, for tests.

export interface ParsedReminder {
  due: Date;
  text: string;
}

/** Local "YYYY-MM-DD[T ]HH:MM" (no time zone means local time). */
const ABSOLUTE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const RELATIVE = /^\+\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i;

export function parseReminder(body: string, now = new Date()): ParsedReminder | { error: string } {
  const i = body.indexOf('|');
  if (i === -1) return { error: 'missing "|" between time and text' };
  const when = body.slice(0, i).trim();
  const text = body
    .slice(i + 1)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!text) return { error: 'missing reminder text' };

  let due: Date | null = null;
  const a = ABSOLUTE.exec(when);
  if (a) {
    due = new Date(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], a[6] ? +a[6] : 0);
    if (due.getMonth() !== +a[2] - 1 || due.getHours() !== +a[4]) return { error: 'invalid date or time' };
  }
  const r = RELATIVE.exec(when);
  if (r) {
    const n = Number(r[1]);
    const unit = r[2][0].toLowerCase();
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    due = new Date(now.getTime() + n * ms);
  }
  if (!due) return { error: `can't understand the time "${when}"` };
  if (due.getTime() < now.getTime() - 60_000) return { error: 'that time has already passed' };
  if (due.getTime() > now.getTime() + 366 * 86_400_000) return { error: 'that is more than a year away' };
  return { due, text };
}

/** "Thu 29 Oct 2026, 15:20" — how the AI is told the current time. */
export function describeNow(now = new Date()): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${time}`;
  return `${date}, ${time} (${tz}); as a local timestamp: ${iso}`;
}

/** "today at 5:00 PM", "tomorrow at 9:30 AM", or a date. */
export function friendlyWhen(due: Date, now = new Date()): string {
  const time = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `${due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}
