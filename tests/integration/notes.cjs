// Integration: memory is encrypted on disk, and reminders fire on time.
const { fakeAI } = require('./_helpers.cjs');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async (h) => {
  fakeAI(h, ['Nice to meet you, Anas! [REMEMBER:The user is called Anas] [REMIND:+0m|Stretch your legs]I will remind you.']);
  h.companion.askTyped('I am Anas. Remind me now to stretch my legs.');
  await h.waitFor(() => h.memories.all().length === 1, 10000, 'memory saved');

  const file = join(h.app.getPath('userData'), 'memory.json');
  h.check(existsSync(file), 'memory file exists');
  h.check(!readFileSync(file).toString('utf8').includes('Anas'), 'memory file is encrypted (no plaintext on disk)');

  await h.waitFor(() => h.companion.status().lastAnswer.startsWith('Reminder'), 30000, 'reminder to fire');
  h.check(/Stretch your legs/.test(h.companion.status().lastAnswer), 'reminder is announced', h.companion.status().lastAnswer);
  h.check(h.upcomingReminders().length === 0, 'fired reminders leave the upcoming list');
  const rfile = join(h.app.getPath('userData'), 'reminders.json');
  h.check(!readFileSync(rfile).toString('utf8').includes('Stretch'), 'reminders file is encrypted too');
};
