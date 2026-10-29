// The Allow / Stop popup.
import { perch } from './bridge';

const text = document.getElementById('text')!;
const allow = document.getElementById('allow') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
let shownAt = 0;

const answer = (ok: boolean) => {
  // Ignore an Enter that was already held down when the popup appeared.
  if (ok && performance.now() - shownAt < 400) return;
  perch.send('confirm:answer', ok);
};

allow.addEventListener('click', () => answer(true));
stop.addEventListener('click', () => answer(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') answer(false);
  if (e.key === 'Enter') {
    e.preventDefault();
    answer(true);
  }
});

perch.on('confirm:show', (m: { text: string }) => {
  text.textContent = m.text;
  shownAt = performance.now();
  stop.focus(); // the safe choice has focus by default
});
