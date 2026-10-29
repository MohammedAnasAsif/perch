import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TagStream, SentenceChunker, cleanForSpeech, type StreamEvent } from '../src/shared/stream';

function run(chunks: string[]): StreamEvent[] {
  const ts = new TagStream();
  const ev: StreamEvent[] = [];
  for (const c of chunks) ev.push(...ts.push(c));
  ev.push(...ts.end());
  return ev;
}
const textOf = (ev: StreamEvent[]) => ev.filter((e) => e.type === 'text').map((e) => (e as any).text).join('');
const pointsOf = (ev: StreamEvent[]) => ev.filter((e) => e.type === 'point').map((e) => (e as any).point);

test('plain text passes through', () => {
  assert.equal(textOf(run(['Hello ', 'there.'])), 'Hello there.');
});

test('tag in one chunk', () => {
  const ev = run(['Click [POINT:120,45:Save button]the save button.']);
  assert.equal(textOf(ev), 'Click the save button.');
  assert.deepEqual(pointsOf(ev), [{ x: 120, y: 45, label: 'Save button' }]);
});

test('tag split across many chunks', () => {
  const s = 'Look [POINT:1200.5,830:File menu] here.';
  const ev = run(s.split(''));
  assert.equal(textOf(ev), 'Look  here.');
  assert.deepEqual(pointsOf(ev), [{ x: 1200.5, y: 830, label: 'File menu' }]);
});

test('tag without label', () => {
  assert.deepEqual(pointsOf(run(['[POINT:5,6]'])), [{ x: 5, y: 6, label: '' }]);
});

test('brackets that are not tags are kept', () => {
  assert.equal(textOf(run(['Use [Ctrl] + ', '[S] to save.'])), 'Use [Ctrl] + [S] to save.');
});

test('unfinished tag at end of stream is dropped', () => {
  assert.equal(textOf(run(['Hi [POINT:12,'])), 'Hi ');
});

test('malformed tag is dropped, text after it kept', () => {
  assert.equal(textOf(run(['A [POINT:abc] B'])), 'A  B');
});

test('sentence chunker splits on sentence ends', () => {
  const c = new SentenceChunker();
  const out = [...c.push('Hi there! This is'), ...c.push(' a test. And 3.5 is a number'), ...c.end()];
  assert.deepEqual(out, ['Hi there!', 'This is a test.', 'And 3.5 is a number']);
});

test('sentence chunker splits on newlines', () => {
  const c = new SentenceChunker();
  assert.deepEqual([...c.push('one\ntwo\n'), ...c.end()], ['one', 'two']);
});

test('cleanForSpeech strips markdown and urls', () => {
  assert.equal(cleanForSpeech('**Open** `File` at https://x.com/a 🎉'), 'Open File at the link');
});
