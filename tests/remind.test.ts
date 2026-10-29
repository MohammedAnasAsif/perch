import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReminder, friendlyWhen } from '../src/shared/remind';

const now = new Date(2026, 9, 29, 15, 20); // Thu 29 Oct 2026, 15:20 local

test('absolute local times', () => {
  const r = parseReminder('2026-10-29T17:00|Send the report', now) as any;
  assert.equal(r.text, 'Send the report');
  assert.equal(r.due.getHours(), 17);
  assert.equal(r.due.getDate(), 29);
  const r2 = parseReminder('2026-10-30 9:05|Standup', now) as any;
  assert.equal(r2.due.getHours(), 9);
  assert.equal(r2.due.getMinutes(), 5);
});

test('relative times', () => {
  const r = parseReminder('+15m|Check the oven', now) as any;
  assert.equal(r.due.getTime() - now.getTime(), 15 * 60_000);
  const r2 = parseReminder('+2 hours|Call mom', now) as any;
  assert.equal(r2.due.getTime() - now.getTime(), 2 * 3_600_000);
});

test('bad reminders explain why', () => {
  assert.match((parseReminder('2026-10-29T10:00|Too late', now) as any).error, /passed/);
  assert.match((parseReminder('tomorrow|x', now) as any).error, /understand/);
  assert.match((parseReminder('2026-02-30T10:00|x', now) as any).error, /invalid/);
  assert.match((parseReminder('+5m', now) as any).error, /\|/);
});

test('friendlyWhen', () => {
  assert.equal(friendlyWhen(new Date(2026, 9, 29, 17, 0), now), 'today at 5:00 PM');
  assert.equal(friendlyWhen(new Date(2026, 9, 30, 9, 30), now), 'tomorrow at 9:30 AM');
});
