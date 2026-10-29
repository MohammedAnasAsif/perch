// Reminders: stored on disk, checked every 15 seconds while Perch runs. Ones
// that came due while Perch was closed fire when it starts again.
import { reminders, type Reminder } from './store';
import { friendlyWhen, parseReminder } from '../shared/remind';

const CHECK_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
let onChange: () => void = () => {};

export function addReminder(body: string): { ok: true; reminder: Reminder; when: string } | { ok: false; error: string } {
  const parsed = parseReminder(body);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  const reminder = reminders.add({
    due: parsed.due.toISOString(),
    text: parsed.text,
    created: new Date().toISOString(),
    done: false,
  });
  console.log(`[perch] reminder set for ${parsed.due.toString()}: ${parsed.text}`);
  onChange();
  return { ok: true, reminder, when: friendlyWhen(parsed.due) };
}

export function upcomingReminders(): Reminder[] {
  return reminders
    .all()
    .filter((r) => !r.done)
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function deleteReminder(id: string) {
  reminders.remove(id);
  onChange();
}

export function startReminders(fire: (r: Reminder, missedBy: number) => void, changed: () => void) {
  onChange = changed;
  const check = () => {
    const now = Date.now();
    for (const r of reminders.all()) {
      if (r.done) continue;
      const due = Date.parse(r.due);
      if (!Number.isFinite(due) || due > now) continue;
      reminders.update(r.id, { done: true });
      fire(r, now - due);
      onChange();
    }
    // Keep the file small: drop finished reminders older than a week.
    for (const r of reminders.all()) {
      if (r.done && Date.parse(r.due) < now - 7 * 86_400_000) reminders.remove(r.id);
    }
  };
  check();
  timer = setInterval(check, CHECK_MS);
}

export function stopReminders() {
  if (timer) clearInterval(timer);
  timer = null;
}
