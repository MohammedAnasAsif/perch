// Acceptance: the user sees what Perch remembers and deletes a note.
const { fakeAI } = require('../integration/_helpers.cjs');

module.exports = async (h) => {
  fakeAI(h, ['Got it! [REMEMBER:The user prefers short answers] [REMEMBER:The user\'s manager is Priya]']);
  h.companion.askTyped('I like short answers, and my manager is Priya.');
  await h.waitFor(() => h.memories.all().length === 2, 10000, 'two memories');

  h.openPanel();
  await h.waitFor(() => h.panel() && !h.panel().webContents.isLoading(), 10000, 'panel');
  const p = h.panel();
  await h.wait(500);
  const items = await h.exec(p, `[...document.querySelectorAll('#memory-list li span')].map(s => s.textContent)`);
  h.check(items.includes('The user prefers short answers') && items.length === 2, 'panel lists what Perch remembers', items);

  // The user clicks the × next to the manager note.
  await h.exec(p, `[...document.querySelectorAll('#memory-list li')].find(li => /Priya/.test(li.textContent)).querySelector('button.x').click(); true`);
  await h.waitFor(() => h.memories.all().length === 1, 5000, 'note to be deleted');
  await h.wait(300);
  const after = await h.exec(p, `[...document.querySelectorAll('#memory-list li span')].map(s => s.textContent)`);
  h.check(after.length === 1 && !after.some((t) => /Priya/.test(t)), 'the deleted note disappears from the panel', after);

  // Turning memory off stops new notes being saved.
  await h.exec(p, `(() => { const t = document.getElementById('memory-on'); t.checked = false; t.dispatchEvent(new Event('change')); return true })()`);
  await h.waitFor(() => h.getSettings().memoryEnabled === false, 3000, 'memory switched off');
  fakeAI(h, ['Okay! [REMEMBER:The user lives in Bengaluru]']);
  h.companion.askTyped('I live in Bengaluru');
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000);
  h.check(h.memories.all().length === 1, 'with memory off, nothing new is remembered', h.memories.all());
};
