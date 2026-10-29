// Integration: action requests reach the agent, by wording or by the chat AI's hand-off.
const { fakeAI, fakeInput, step } = require('./_helpers.cjs');

module.exports = async (h) => {
  const input = fakeInput(h);
  let mode = [];
  const calls = fakeAI(h, [
    (o) => {
      mode.push(o.json ? 'agent' : 'chat');
      return o.json ? step('Searching', { type: 'browser_search', query: 'clicky' }) : '[AGENT]';
    },
    (o) => {
      mode.push(o.json ? 'agent' : 'chat');
      return step('Done', { type: 'done', summary: 'I searched for Clicky.' });
    },
  ]);
  // Opening a real browser tab isn't wanted in tests.
  require('electron').shell.openExternal = async () => {};

  // 1. Worded as an action: goes straight to the agent.
  h.companion.askTyped('Can you search for clicky?');
  await h.waitFor(() => h.companion.status().lastAnswer === 'I searched for Clicky.', 15000, 'agent summary');
  h.check(mode[0] === 'agent', '"Can you search…" goes straight to the agent', mode);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // 2. Not obviously an action, but the chat AI hands it over with [AGENT].
  mode = [];
  calls.length = 0;
  let n = 0;
  h.providers.claude.stream = async (o, onText) => {
    n++;
    mode.push(o.json ? 'agent' : 'chat');
    const text = !o.json ? '[AGENT]' : step('Done', { type: 'done', summary: 'Handled by the agent.' });
    onText(text);
    return text;
  };
  h.companion.askTyped('I need the weather report saved somewhere for tomorrow');
  await h.waitFor(() => h.companion.status().lastAnswer === 'Handled by the agent.', 15000, 'hand-off summary');
  h.check(mode[0] === 'chat' && mode[1] === 'agent', 'chat hands the request to the agent', mode);
  h.check(!input.some((c) => c.name === 'click'), 'nothing was clicked');
};
