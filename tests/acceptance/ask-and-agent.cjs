// Acceptance: a user types a question in the panel, then asks the agent to do
// a task, watches its progress, and stops a second task with Esc.
const { fakeAI, fakeInput, step } = require('../integration/_helpers.cjs');

module.exports = async (h) => {
  const input = fakeInput(h, {
    elements: { title: 'Untitled - Notepad', app: 'notepad', items: [{ t: 'Document', n: 'Text editor', v: '', p: false, x: 300, y: 300, w: 600, h: 400 }] },
  });

  // --- Ask a question by typing in the panel
  fakeAI(h, ['Click File, then Save As.']);
  h.openPanel();
  await h.waitFor(() => h.panel() && !h.panel().webContents.isLoading(), 10000, 'panel');
  const p = h.panel();
  await h.exec(p, `(() => { const i = document.getElementById('ask'); i.value = 'How do I save this as a PDF?'; document.getElementById('ask-form').requestSubmit(); return true })()`);
  await h.waitFor(() => !p.isVisible(), 3000, 'panel to get out of the way');
  h.check(true, 'the panel hides so it is not in the screenshot');
  await h.waitFor(() => h.companion.status().lastAnswer === 'Click File, then Save As.', 10000, 'answer');
  h.openPanel();
  await h.wait(300);
  const q = await h.exec(p, `document.getElementById('last-q').textContent`);
  const a = await h.exec(p, `document.getElementById('last-a').textContent`);
  h.check(q === 'How do I save this as a PDF?' && a === 'Click File, then Save As.', 'panel shows the last question and answer', { q, a });
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // --- An agent task, with visible progress
  require('electron').shell.openExternal = async () => {};
  let statusDuring = '';
  fakeAI(h, [
    step('Opening Notepad', { type: 'open', target: 'notepad' }),
    async () => {
      statusDuring = await h.exec(p, `document.getElementById('status').textContent`);
      return step('Writing the letter', { type: 'type_into', id: 1, text: 'Dear Priya,\nI will be on leave tomorrow.' });
    },
    step('Done', { type: 'done', summary: 'I wrote your leave letter in Notepad.' }),
  ]);
  h.companion.askTyped('open notepad and write a leave letter to Priya for tomorrow');
  await h.waitFor(() => h.companion.status().lastAnswer === 'I wrote your leave letter in Notepad.', 15000, 'agent to finish');
  h.check(/Agent/.test(statusDuring), 'panel shows the agent is working', statusDuring);
  const typed = input.filter((c) => c.name === 'type').map((c) => c.args[0]).join('');
  h.check(/Dear Priya/.test(typed), 'the letter was typed', typed);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // --- Esc stops a task in progress
  input.length = 0;
  fakeAI(h, [
    step('Step', { type: 'wait', seconds: 3 }),
    step('Typing', { type: 'type', text: 'should never be typed' }),
  ]);
  h.companion.askTyped('agent do a long task');
  await h.waitFor(() => h.companion.currentState() === 'working', 5000, 'agent to start');
  await h.wait(500);
  const t0 = Date.now();
  h.escape();
  await h.waitFor(() => h.companion.currentState() === 'idle', 3000, 'Esc to stop the agent');
  h.check(Date.now() - t0 < 1500, 'Esc stops the agent within a second or so', Date.now() - t0);
  await h.wait(3500);
  h.check(!input.some((c) => c.name === 'type'), 'nothing happens after stopping', input);
};
