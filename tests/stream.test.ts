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

test('agent hand-off tag, whole or split', () => {
  assert.deepEqual(run(['[AGENT]']), [{ type: 'agent' }]);
  assert.deepEqual(run(['[AG', 'ENT', ']']), [{ type: 'agent' }]);
  const ev = run(['Sure. ', '[agent]']);
  assert.deepEqual(ev, [{ type: 'text', text: 'Sure. ' }, { type: 'agent' }]);
  assert.equal(textOf(run(['[A] is a grade'])), '[A] is a grade');
});

test('drawing tags: circle, box and arrow', () => {
  const ev = run(['Here [CIRCLE:100,200,30:Save] and [BOX:10,20,', '300,40:Toolbar] then [ARROW:5,5,50,60:this way] done']);
  assert.equal(textOf(ev), 'Here  and  then  done');
  assert.deepEqual(pointsOf(ev), [
    { x: 100, y: 200, label: 'Save', shape: { kind: 'circle', r: 30 } },
    { x: 10, y: 20, label: 'Toolbar', shape: { kind: 'box', w: 300, h: 40 } },
    { x: 50, y: 60, label: 'this way', shape: { kind: 'arrow', fromX: 5, fromY: 5 } },
  ]);
});

test('drawing tags with the wrong number of values are dropped', () => {
  const ev = run(['A [CIRCLE:1,2:x] B [BOX:1,2,3] C']);
  assert.equal(textOf(ev), 'A  B  C');
  assert.deepEqual(pointsOf(ev), []);
});

test('remember and remind tags are pulled out of the text', () => {
  const ev = run(['Nice to meet you, Anas! [REMEMBER:The user\'s name is Anas] I\'ll remind you. [REMIND:2026-10-29T17:00|Send the', ' report]']);
  assert.equal(textOf(ev), "Nice to meet you, Anas! I'll remind you. ");
  assert.deepEqual(
    ev.filter((e) => e.type === 'remember' || e.type === 'remind'),
    [
      { type: 'remember', text: "The user's name is Anas" },
      { type: 'remind', body: '2026-10-29T17:00|Send the report' },
    ],
  );
});
