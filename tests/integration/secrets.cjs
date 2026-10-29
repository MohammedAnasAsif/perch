// Integration: secrets never reach the AI, are never typed, and are never remembered.
const { fakeAI, fakeInput, step } = require('./_helpers.cjs');

module.exports = async (h) => {
  const { clipboard } = require('electron');
  fakeInput(h);

  // 1. Secrets in the question and in the clipboard are redacted before sending.
  clipboard.writeText('Card 4111 1111 1111 1111, CVV 123, password: hunter2');
  const calls = fakeAI(h, ['Got it.']);
  h.companion.askTyped('Summarise what I copied. My Aadhaar is 2341 2341 2346');
  await h.waitFor(() => calls.length, 10000, 'AI request');
  const sent = calls[0].messages.at(-1).text;
  h.check(!/4111|hunter2|2341 2341 2346/.test(sent), 'no card, password or Aadhaar number is sent', sent);
  h.check(/\[redacted card number\]/.test(sent) && /\[redacted Aadhaar number\]/.test(sent), 'redaction markers are sent instead', sent);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // 2. The agent can't type a card number, even if the AI asks it to.
  const input = fakeInput(h);
  fakeAI(h, [
    step('Typing', { type: 'type', text: '4111 1111 1111 1111', target: 'payment box' }),
    (o) => {
      const last = o.messages.at(-1).text;
      return step('Asking', { type: 'ask_user', question: /Blocked/.test(last) ? 'Please type your card number yourself.' : 'unexpected' });
    },
  ]);
  h.companion.askTyped('agent pay for my order');
  await h.waitFor(() => h.companion.status().lastAnswer, 10000, 'agent result');
  h.check(!input.some((c) => c.name === 'type'), 'the card number was never typed', input);
  h.check(h.companion.status().lastAnswer === 'Please type your card number yourself.', 'the agent is told it was blocked', h.companion.status().lastAnswer);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // 3. Memory refuses secrets but keeps normal facts.
  fakeAI(h, ['Noted! [REMEMBER:Wifi password: Hunter2!] [REMEMBER:The user prefers short answers]']);
  h.companion.askTyped('My wifi password is Hunter2! and I like short answers');
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);
  const notes = h.memories.all().map((m) => m.text);
  h.check(!notes.some((t) => /Hunter2/.test(t)), 'a password is never remembered', notes);
  h.check(notes.includes('The user prefers short answers'), 'a normal preference is remembered', notes);

  // 4. The log file on disk doesn't contain the secrets either.
  await h.wait(300);
  const logFile = require('node:path').join(h.app.getPath('userData'), 'logs', 'perch.log');
  const log = require('node:fs').readFileSync(logFile, 'utf8');
  const leaks = log.split('\n').filter((l) => /4111 1111 1111 1111|hunter2|2341 2341 2346/i.test(l));
  h.check(leaks.length === 0, 'the log file stays free of secrets', leaks);
};
