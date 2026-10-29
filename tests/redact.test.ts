// Written before src/shared/redact.ts (TDD): the spec for secret redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecret, redactSecrets } from '../src/shared/redact';

const r = (s: string) => redactSecrets(s).text;
const kinds = (s: string) => redactSecrets(s).found.sort();

// ---------------------------------------------------------------- cards

test('card numbers that pass the Luhn check are redacted, in any common format', () => {
  assert.equal(r('my card is 4111 1111 1111 1111 ok'), 'my card is [redacted card number] ok');
  assert.equal(r('4111-1111-1111-1111'), '[redacted card number]');
  assert.equal(r('5500005555555559'), '[redacted card number]');
  assert.equal(r('Amex 3782 822463 10005'), 'Amex [redacted card number]');
});

test('long numbers that fail Luhn are left alone (order ids, phone numbers)', () => {
  assert.equal(r('order 4111 1111 1111 1112'), 'order 4111 1111 1111 1112');
  assert.equal(r('call +91 98765 43210'), 'call +91 98765 43210');
  assert.equal(r('in 2026 we had 1500 users'), 'in 2026 we had 1500 users');
});

// ---------------------------------------------------------------- keys and tokens

test('API keys and tokens are redacted', () => {
  assert.equal(r('key sk-ant-api03-AbCdEf1234567890xyzXYZ_-'), 'key [redacted API key]');
  assert.equal(r('AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW'), '[redacted API key]');
  assert.equal(r('token ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'token [redacted API key]');
  assert.equal(r('sk-proj-abcdefghijklmnopqrstuvwxyz123456'), '[redacted API key]');
  assert.equal(r('AKIAIOSFODNN7EXAMPLE'), '[redacted API key]');
  assert.equal(r('xoxb-123456789012-1234567890123-abcdefABCDEF'), '[redacted API key]');
});

test('JWTs and private keys are redacted', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.equal(r(`Bearer ${jwt}`), 'Bearer [redacted token]');
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----';
  assert.equal(r(`here:\n${pem}\nthanks`), 'here:\n[redacted private key]\nthanks');
});

// ---------------------------------------------------------------- passwords

test('passwords written as label: value are redacted, keeping the label', () => {
  assert.equal(r('password: hunter2!'), 'password: [redacted password]');
  assert.equal(r('Password = "s3cr3t pass"'), 'Password = [redacted password]');
  assert.equal(r('wifi pwd=MyWifi@123 and more'), 'wifi pwd=[redacted password] and more');
  assert.equal(r('PIN: 4821'), 'PIN: [redacted password]');
});

test('passwords said in a sentence are redacted', () => {
  assert.equal(r('my wifi password is Hunter2!'), 'my wifi password is [redacted password]');
  assert.equal(r('The PIN was 4821 yesterday'), 'The PIN was [redacted password] yesterday');
  // Plain words after "is" aren't passwords.
  assert.equal(r('the password is in the drawer'), 'the password is in the drawer');
  assert.equal(r('my password is wrong'), 'my password is wrong');
});

test('the word password alone is not redacted', () => {
  assert.equal(r('How do I reset my password?'), 'How do I reset my password?');
  assert.equal(r('the password field is empty'), 'the password field is empty');
});

// ---------------------------------------------------------------- Indian IDs and IBAN

test('Aadhaar numbers that pass the Verhoeff check are redacted', () => {
  // 2341 2341 2346 is a valid test Aadhaar (Verhoeff checksum).
  assert.equal(r('aadhaar 2341 2341 2346'), 'aadhaar [redacted Aadhaar number]');
  assert.equal(r('2341 2341 2345'), '2341 2341 2345'); // bad checksum
});

test('PAN and IBAN are redacted', () => {
  // The 4th letter is the holder type (P = person, C = company, …).
  assert.equal(r('PAN ABCPE1234F'), 'PAN [redacted PAN]');
  assert.equal(r('part ABCDE1234F'), 'part ABCDE1234F'); // not a valid PAN holder type
  assert.equal(r('IBAN GB82 WEST 1234 5698 7654 32'), 'IBAN [redacted IBAN]');
  assert.equal(r('model ABCDE is fine'), 'model ABCDE is fine');
});

// ---------------------------------------------------------------- reporting

test('reports which kinds were found, and containsSecret agrees', () => {
  assert.deepEqual(kinds('4111111111111111 and password: x1'), ['card number', 'password']);
  assert.equal(containsSecret('hello world'), false);
  assert.equal(containsSecret('sk-ant-api03-AbCdEf1234567890xyzXYZ'), true);
});

test('plain text passes through unchanged and quickly', () => {
  const text = 'Click the Insert tab, then Page Number. '.repeat(500);
  const t0 = performance.now();
  assert.equal(r(text), text);
  assert.ok(performance.now() - t0 < 200, 'redaction should be fast');
});
