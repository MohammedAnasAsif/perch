import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchWake, Vad, DEFAULT_VAD } from '../src/shared/wake';

test('matchWake: wake phrase with and without a command', () => {
  assert.equal(matchWake('Hey Perch, what is this?'), 'what is this?');
  assert.equal(matchWake('hey perch'), '');
  assert.equal(matchWake('Hey Birch. Open Chrome.'), 'Open Chrome.');
  assert.equal(matchWake('Okay perch open notepad'), 'open notepad');
  assert.equal(matchWake('Perch, can you help'), 'can you help');
});

test('matchWake: ordinary speech is ignored', () => {
  assert.equal(matchWake('We should research perch fishing'), null);
  assert.equal(matchWake('hey there'), null);
  assert.equal(matchWake(''), null);
});

function frames(level: number, ms: number) {
  const n = Math.round(ms / DEFAULT_VAD.frameMs);
  const size = (16000 * DEFAULT_VAD.frameMs) / 1000;
  return Array.from({ length: n }, () => Float32Array.from({ length: size }, (_, i) => (i % 2 ? level : -level)));
}

test('Vad: speech surrounded by silence becomes one segment', () => {
  const segs: Float32Array[] = [];
  const vad = new Vad((s) => segs.push(s));
  for (const f of [...frames(0.002, 1000), ...frames(0.1, 1200), ...frames(0.002, 1000)]) vad.push(f);
  assert.equal(segs.length, 1);
  const secs = segs[0].length / 16000;
  assert.ok(secs > 1.2 && secs < 2.6, `segment was ${secs}s`);
});

test('Vad: short clicks are ignored', () => {
  const segs: Float32Array[] = [];
  const vad = new Vad((s) => segs.push(s));
  for (const f of [...frames(0.002, 500), ...frames(0.2, 128), ...frames(0.002, 1500)]) vad.push(f);
  assert.equal(segs.length, 0);
});

test('Vad: very long speech is cut at the maximum length', () => {
  const segs: Float32Array[] = [];
  const vad = new Vad((s) => segs.push(s));
  for (const f of frames(0.1, 23_000)) vad.push(f);
  assert.equal(segs.length, 2);
});
