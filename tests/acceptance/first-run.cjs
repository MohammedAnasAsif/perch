// Acceptance: a brand-new user with no API key sets Perch up through the panel.
// @unset ANTHROPIC_API_KEY
// @unset GEMINI_API_KEY
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async (h) => {
  // Perch opens its panel by itself on first run.
  await h.waitFor(() => h.panel() && h.panel().isVisible() && !h.panel().webContents.isLoading(), 10000, 'the panel to open by itself');
  const p = h.panel();
  await h.wait(400);
  const onboard = await h.exec(p, `!document.getElementById('onboard').hidden`);
  h.check(onboard, 'first run shows "Choose the AI Perch uses"');
  const status = await h.exec(p, `document.getElementById('status').textContent`);
  h.check(/Choose your AI/.test(status), 'status line asks the user to choose an AI', status);
  const choices = await h.exec(p, `[...document.querySelectorAll('.choice strong')].map(e => e.textContent)`);
  h.check(choices.length === 3, 'three AI options are offered', choices);

  // The user picks the free Gemini option.
  await h.exec(p, `document.querySelector('.choice[data-provider="gemini"]').click(); true`);
  await h.waitFor(() => h.exec(p, `!document.querySelector('.key-form[data-provider="gemini"]').hidden`), 5000, 'the Gemini key box');
  h.check(h.getSettings().provider === 'gemini', 'choice is saved');

  // …pastes a key and presses Save.
  const KEY = 'AIzaSyTestKey_0123456789abcdefghijklmn';
  await h.exec(
    p,
    `(() => { const f = document.querySelector('.key-form[data-provider="gemini"]'); f.querySelector('input').value = ${JSON.stringify(KEY)}; f.requestSubmit(); return true })()`,
  );
  await h.waitFor(() => h.exec(p, `document.getElementById('onboard').hidden`), 5000, 'onboarding to finish');
  // The speech model may still be downloading on a fresh install; a user would wait for it.
  const statusText = () => h.exec(p, `document.getElementById('status').textContent`);
  const firstStatus = await statusText();
  h.check(!/Choose your AI/.test(firstStatus), 'status no longer asks to choose an AI', firstStatus);
  let ready = firstStatus;
  try {
    await h.waitFor(async () => /Ready/.test((ready = await statusText())), 90000, 'status to say Ready');
  } catch {}
  h.check(/Ready/.test(ready), 'status says Ready once speech recognition has loaded', ready);
  const keyState = await h.exec(p, `document.getElementById('gemini-key-state').textContent`);
  h.check(/Saved securely/.test(keyState), 'panel confirms the key is saved securely', keyState);
  const keyBox = await h.exec(p, `document.querySelector('.key-form[data-provider="gemini"] input').value`);
  h.check(keyBox === '', 'the key is cleared from the box after saving');

  const file = join(h.app.getPath('userData'), 'gemini-key.bin');
  h.check(existsSync(file), 'key file is written');
  h.check(!readFileSync(file).toString('latin1').includes(KEY), 'the key is not stored in plain text');

  // A wrong Claude key format is caught with a helpful message, and nothing is saved.
  const r = await h.exec(p, `window.perch.invoke('panel:set-key', 'claude', 'not-a-key')`);
  h.check(!r.ok && /sk-ant-/.test(r.error), 'an invalid Claude key is rejected with a hint', r);
};
