import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PushToTalk, KEY } from '../src/main/ptt';

function make(combo: 'ctrl+alt' | 'ctrl+win' = 'ctrl+alt') {
  const log: string[] = [];
  const p = new PushToTalk(
    combo,
    {
      onStart: () => log.push('start'),
      onStop: () => log.push('stop'),
      onCancel: () => log.push('cancel'),
      onEscape: () => log.push('esc'),
    },
    20,
  );
  return { p, log };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('hold then release starts and stops', async () => {
  const { p, log } = make();
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Alt);
  await wait(40);
  p.keyup(KEY.Alt);
  p.keyup(KEY.Ctrl);
  assert.deepEqual(log, ['start', 'stop']);
});

test('quick tap does nothing', async () => {
  const { p, log } = make();
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Alt);
  p.keyup(KEY.Alt);
  p.keyup(KEY.Ctrl);
  await wait(40);
  assert.deepEqual(log, []);
});

test('shortcut like Ctrl+Alt+T is ignored', async () => {
  const { p, log } = make();
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Alt);
  p.keydown(20); // T
  await wait(40);
  p.keyup(20);
  p.keyup(KEY.Alt);
  p.keyup(KEY.Ctrl);
  assert.deepEqual(log, []);
});

test('other key while talking cancels', async () => {
  const { p, log } = make();
  p.keydown(KEY.CtrlRight);
  p.keydown(KEY.AltRight);
  await wait(40);
  p.keydown(18); // E (AltGr typing)
  p.keyup(18);
  p.keyup(KEY.AltRight);
  p.keyup(KEY.CtrlRight);
  assert.deepEqual(log, ['start', 'cancel']);
});

test('works again after a spoiled hold', async () => {
  const { p, log } = make();
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Alt);
  p.keydown(20);
  p.keyup(20);
  p.keyup(KEY.Alt);
  p.keyup(KEY.Ctrl);
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Alt);
  await wait(40);
  p.keyup(KEY.Ctrl);
  assert.deepEqual(log, ['start', 'stop']);
});

test('key repeat does not restart', async () => {
  const { p, log } = make('ctrl+win');
  p.keydown(KEY.Ctrl);
  p.keydown(KEY.Meta);
  await wait(40);
  p.keydown(KEY.Meta);
  p.keydown(KEY.Ctrl);
  await wait(40);
  p.keyup(KEY.Meta);
  assert.deepEqual(log, ['start', 'stop']);
});
