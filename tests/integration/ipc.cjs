// Integration: pages can only send their own messages, with valid payloads.
module.exports = async (h) => {
  let asked = [];
  const real = h.companion.askTyped.bind(h.companion);
  h.companion.askTyped = (q) => asked.push(q);

  h.openPanel();
  await h.waitFor(() => h.panel() && !h.panel().webContents.isLoading(), 10000, 'panel');
  const overlay = h.findWindow('overlay.html');
  await h.waitFor(() => overlay && !overlay.webContents.isLoading(), 10000, 'overlay');

  // The overlay only displays things; it may not send panel commands.
  await h.exec(overlay, `window.perch.send('panel:ask', 'from the overlay'); true`);
  // The panel may, with a proper string.
  await h.exec(h.panel(), `window.perch.send('panel:ask', 'from the panel'); true`);
  // But not with the wrong type, or an oversized payload.
  await h.exec(h.panel(), `window.perch.send('panel:ask', 12345); window.perch.send('panel:ask', 'x'.repeat(10000)); true`);
  // And the panel can't answer the agent's approval popup.
  await h.exec(h.panel(), `window.perch.send('confirm:answer', true); true`);
  // Unknown channels are refused by the preload itself.
  const blocked = await h.exec(h.panel(), `(() => { try { window.perch.send('ollama:run', 'x'); return false } catch { return true } })()`);
  await h.wait(500);

  h.check(asked.length === 1 && asked[0] === 'from the panel', 'only the valid panel message got through', asked);
  h.check(h.logs.some((l) => /ignored "panel:ask" from an untrusted page/.test(l)), 'the overlay attempt is logged');
  h.check(h.logs.some((l) => /ignored "panel:ask": bad argument 1/.test(l)), 'bad payloads are logged');
  h.check(h.logs.some((l) => /ignored "confirm:answer" from an untrusted page/.test(l)), 'the panel cannot approve agent actions');
  h.check(blocked === true, 'unknown channels are blocked in the page');

  // Settings from the panel are validated: unknown keys and wrong types are dropped.
  const r = await h.exec(
    h.panel(),
    `window.perch.invoke('panel:update-settings', { provider: 'evil', speechRate: 'fast', agentConfirm: 'never', __proto__x: 1, privateApps: 'bank' })`,
  );
  h.check(r.settings.provider !== 'evil' && r.settings.agentConfirm === 'risky' && typeof r.settings.speechRate === 'number', 'bad settings are rejected', r.settings);
  h.check(!('__proto__x' in r.settings), 'unknown setting keys are ignored');
  h.companion.askTyped = real;
};
