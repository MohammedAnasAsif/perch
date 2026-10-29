// Integration: risky agent actions wait for the Allow/Stop popup, clicked the way
// a user would (through the popup page, its preload and the IPC checks).
const { fakeAI, fakeInput, step } = require('./_helpers.cjs');

async function clickPopup(h, id) {
  await h.waitFor(() => {
    const w = h.findWindow('confirm.html');
    return w && w.isVisible();
  }, 10000, 'the approval popup');
  const w = h.findWindow('confirm.html');
  await h.wait(500); // the popup ignores clicks in its first 400 ms
  await h.exec(w, `document.getElementById('${id}').click(); true`);
  return w;
}

module.exports = async (h) => {
  const input = fakeInput(h, {
    elements: { title: 'Mail', app: 'outlook', items: [{ t: 'Button', n: 'Send', v: '', p: false, x: 400, y: 300, w: 60, h: 24 }] },
  });
  const sendStep = step('Sending', { type: 'click_element', id: 1, risky: true });

  // --- Stop
  fakeAI(h, [sendStep, step('Done', { type: 'done', summary: 'Sent.' })]);
  h.companion.askTyped('agent send the email');
  const popup = await clickPopup(h, 'stop');
  const text = await h.exec(popup, `document.getElementById('text').textContent`);
  h.check(/Send/.test(text), 'popup says what Perch wants to do', text);
  await h.waitFor(() => h.companion.status().lastAnswer, 10000, 'result');
  h.check(h.companion.status().lastAnswer === 'Stopped at your request.', 'Stop ends the task', h.companion.status().lastAnswer);
  h.check(!input.some((c) => c.name === 'click'), 'nothing was clicked after Stop', input);
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);

  // --- Allow
  input.length = 0;
  fakeAI(h, [sendStep, step('Done', { type: 'done', summary: 'Sent the email.' })]);
  h.companion.askTyped('agent send the email');
  await clickPopup(h, 'allow');
  await h.waitFor(() => h.companion.status().lastAnswer === 'Sent the email.', 10000, 'result');
  const click = input.find((c) => c.name === 'click');
  h.check(click && click.args[0] === 430 && click.args[1] === 312, 'Allow clicks the centre of the Send button', click);
};
