// Written before src/main/jsonlist.ts (TDD): encrypted local lists and the
// "never remember secrets" rule.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonList, rememberIn, type Codec } from '../src/main/jsonlist';

// A stand-in for Windows DPAPI: reversible, and obviously not plaintext.
const fakeCodec: Codec = {
  available: () => true,
  encrypt: (s) => Buffer.from('ENC:' + Buffer.from(s).toString('base64')),
  decrypt: (b) => {
    const t = b.toString();
    if (!t.startsWith('ENC:')) throw new Error('not encrypted');
    return Buffer.from(t.slice(4), 'base64').toString();
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perch-store-'));
});

interface Note {
  id: string;
  text: string;
}

test('items survive a reload', () => {
  const a = new JsonList<Note>(() => dir, 'notes.json', 10, fakeCodec);
  a.add({ text: 'hello' });
  const b = new JsonList<Note>(() => dir, 'notes.json', 10, fakeCodec);
  assert.deepEqual(
    b.all().map((n) => n.text),
    ['hello'],
  );
});

test('the file on disk is encrypted, not readable JSON', () => {
  const a = new JsonList<Note>(() => dir, 'notes.json', 10, fakeCodec);
  a.add({ text: 'my manager is Priya' });
  const raw = readFileSync(join(dir, 'notes.json'));
  assert.ok(!raw.toString().includes('Priya'), 'plaintext must not be on disk');
  assert.ok(raw.toString().startsWith('ENC:'));
});

test('an old plaintext file is read, then re-saved encrypted', () => {
  writeFileSync(join(dir, 'notes.json'), JSON.stringify([{ id: '1', text: 'from v0.3' }]));
  const a = new JsonList<Note>(() => dir, 'notes.json', 10, fakeCodec);
  assert.deepEqual(
    a.all().map((n) => n.text),
    ['from v0.3'],
  );
  a.add({ text: 'new' });
  assert.ok(!readFileSync(join(dir, 'notes.json')).toString().includes('from v0.3'));
});

test('a corrupt file gives an empty list instead of crashing', () => {
  writeFileSync(join(dir, 'notes.json'), 'ENC:@@@not base64 json@@@');
  const a = new JsonList<Note>(() => dir, 'notes.json', 10, fakeCodec);
  assert.deepEqual(a.all(), []);
});

test('the list is capped, dropping the oldest', () => {
  const a = new JsonList<Note>(() => dir, 'notes.json', 3, fakeCodec);
  for (const t of ['a', 'b', 'c', 'd']) a.add({ text: t });
  assert.deepEqual(
    a.all().map((n) => n.text),
    ['b', 'c', 'd'],
  );
});

test('when encryption is unavailable, nothing is written to disk', () => {
  const noCrypto: Codec = { ...fakeCodec, available: () => false };
  const a = new JsonList<Note>(() => dir, 'notes.json', 10, noCrypto);
  a.add({ text: 'secret-ish' });
  assert.equal(existsSync(join(dir, 'notes.json')), false);
  assert.deepEqual(
    a.all().map((n) => n.text),
    ['secret-ish'],
    'still kept in memory for this session',
  );
});

// ---------------------------------------------------------------- remember()

interface Mem {
  id: string;
  text: string;
  created: string;
}

test('remember stores a fact once (near-duplicates are skipped)', () => {
  const list = new JsonList<Mem>(() => dir, 'memory.json', 100, fakeCodec);
  assert.ok(rememberIn(list, 'The user prefers short answers'));
  assert.equal(rememberIn(list, 'the user prefers short answers.'), null);
  assert.equal(list.all().length, 1);
});

test('remember refuses anything that looks like a secret', () => {
  const list = new JsonList<Mem>(() => dir, 'memory.json', 100, fakeCodec);
  assert.equal(rememberIn(list, "The user's card is 4111 1111 1111 1111"), null);
  assert.equal(rememberIn(list, 'Wifi password: Hunter2!'), null);
  assert.equal(rememberIn(list, 'API key sk-ant-api03-AbCdEf1234567890xyz'), null);
  assert.equal(list.all().length, 0);
});

test('remember ignores tiny or empty notes and trims long ones', () => {
  const list = new JsonList<Mem>(() => dir, 'memory.json', 100, fakeCodec);
  assert.equal(rememberIn(list, '  '), null);
  const m = rememberIn(list, 'x'.repeat(1000));
  assert.equal(m?.text.length, 300);
});
