// Acceptance: settings changed in the panel are still there after restarting Perch.
// @runs 2
module.exports = async (h) => {
  h.openPanel();
  await h.waitFor(() => h.panel() && !h.panel().webContents.isLoading(), 10000, 'panel');
  const p = h.panel();
  await h.wait(400);

  if (process.env.PERCH_TEST_RUN === '1') {
    // The user changes a few things, the way they would in the panel.
    await h.exec(
      p,
      `(() => {
        const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('change')); };
        set('hotkey', 'ctrl+shift');
        set('rate', '1.3');
        set('privacy-guard', true);
        set('private-apps', 'signal, payroll');
        set('agent-confirm', 'every');
        document.querySelector('#effort button[data-value="high"]').click();
        return true;
      })()`,
    );
    await h.waitFor(() => h.getSettings().agentConfirm === 'every' && h.getSettings().effort === 'high', 3000, 'settings to save');
    h.check(true, 'settings saved');
    return;
  }

  // Second start: everything is as the user left it, in settings and in the UI.
  const s = h.getSettings();
  h.check(s.hotkey === 'ctrl+shift' && s.speechRate === 1.3 && s.privateApps === 'signal, payroll' && s.agentConfirm === 'every' && s.effort === 'high', 'settings survived a restart', s);
  const ui = await h.exec(
    p,
    `({ hotkey: document.getElementById('hotkey').value, apps: document.getElementById('private-apps').value, confirm: document.getElementById('agent-confirm').value, effort: document.querySelector('#effort [aria-checked="true"]')?.dataset.value })`,
  );
  h.check(ui.hotkey === 'ctrl+shift' && ui.apps === 'signal, payroll' && ui.confirm === 'every' && ui.effort === 'high', 'the panel shows the saved settings', ui);
};
