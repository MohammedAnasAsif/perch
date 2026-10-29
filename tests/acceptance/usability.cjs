// Acceptance (customer's eye): the panel is usable, accessible and tidy.
module.exports = async (h) => {
  h.openPanel();
  await h.waitFor(() => h.panel() && !h.panel().webContents.isLoading(), 10000, 'panel');
  const p = h.panel();
  await h.wait(500);

  const report = await h.exec(
    p,
    `(() => {
      const visible = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
      const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.title || '').trim();
      const unnamedButtons = [...document.querySelectorAll('button')].filter(visible).filter((b) => !name(b)).map((b) => b.outerHTML.slice(0, 80));
      const unlabelled = [...document.querySelectorAll('input, select, textarea')].filter(visible).filter((e) => {
        if (e.getAttribute('aria-label')) return false;
        if (e.id && document.querySelector('label[for="' + e.id + '"]')) return false;
        return !e.closest('label');
      }).map((e) => e.outerHTML.slice(0, 80));
      const main = document.querySelector('main');
      return {
        unnamedButtons,
        unlabelled,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth || main.scrollWidth > main.clientWidth + 1,
        sections: [...document.querySelectorAll('.section-title')].map((e) => e.textContent),
        lang: document.documentElement.lang,
        title: document.title,
      };
    })()`,
  );
  h.check(report.unnamedButtons.length === 0, 'every button has a name screen readers can announce', report.unnamedButtons);
  h.check(report.unlabelled.length === 0, 'every field has a label', report.unlabelled);
  h.check(!report.overflowX, 'nothing spills off the side of the panel');
  h.check(report.lang === 'en' && report.title === 'Perch', 'page language and title are set', report);
  for (const s of ['AI', 'Agent', 'Voice', 'Privacy', 'Memory and reminders', 'Behaviour']) {
    h.check(report.sections.includes(s), `the "${s}" section is there`, report.sections);
  }

  // Keyboard users can close the panel with Esc.
  p.webContents.focus();
  p.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await h.waitFor(() => !p.isVisible(), 3000, 'Esc to close the panel');
  h.check(true, 'Esc closes the panel');
};
