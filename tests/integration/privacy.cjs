// Integration: no screenshots and no agent actions in private apps.
const { fakeAI, fakeInput, step } = require('./_helpers.cjs');

module.exports = async (h) => {
  // A banking page is in front.
  const input = fakeInput(h, { window: { app: 'chrome', title: 'HDFC Bank NetBanking - Google Chrome' } });
  const calls = fakeAI(h, ['I can’t see your screen right now because it’s private.']);

  h.companion.askTyped('What is my balance?');
  await h.waitFor(() => calls.length, 10000, 'AI request');
  const msg = calls[0].messages.at(-1);
  h.check(!msg.image, 'no screenshot is sent while a banking page is open');
  h.check(/did not share the screen because a banking or payment page is open/.test(msg.text), 'the AI is told why', msg.text);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // The agent refuses to start there.
  calls.length = 0;
  fakeAI(h, [step('Clicking', { type: 'click', x: 1, y: 1, target: 'Transfer' })]);
  h.companion.askTyped('agent transfer 500 rupees to Priya');
  await h.waitFor(() => h.companion.status().lastAnswer, 10000, 'agent result');
  h.check(/I stopped because a banking or payment page is open/.test(h.companion.status().lastAnswer), 'agent stops in a banking page', h.companion.status().lastAnswer);
  h.check(!input.some((c) => c.name === 'click'), 'nothing was clicked');
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // A user-added private app.
  fakeInput(h, { window: { app: 'Signal', title: 'Signal' } });
  h.updateSettings({ privateApps: 'signal, payroll' });
  const c2 = fakeAI(h, ['ok']);
  h.companion.askTyped('What does this say?');
  await h.waitFor(() => c2.length, 10000, 'AI request');
  h.check(!c2[0].messages.at(-1).image, 'apps on the private list are not captured');
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // Turning the guard off restores screenshots.
  h.updateSettings({ privacyGuard: false });
  const c3 = fakeAI(h, ['ok']);
  h.companion.askTyped('What does this say?');
  await h.waitFor(() => c3.length, 10000, 'AI request');
  h.check(!!c3[0].messages.at(-1).image, 'with the guard off, the screen is shared again');
};
