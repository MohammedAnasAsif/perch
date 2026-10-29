// The buddy: follows the cursor, shows what it's doing, talks in a bubble and
// flies over to point at things.
import { perch } from './bridge';
import type { BubbleMsg, BuddyState, CursorMsg, PointMsg } from '../shared/types';

const $ = (id: string) => document.getElementById(id)!;
const buddy = $('buddy');
const pill = $('pill');
const pillText = $('pill-text');
const bubble = $('bubble');
const bubbleText = $('bubble-text');
const target = $('target');
const draw = document.getElementById('draw') as unknown as SVGSVGElement;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Tip of the buddy sits this far from the cursor tip, beside the arrow.
const FOLLOW_OFFSET = { x: 16, y: 18 };
const FLY_MS = 620;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let state: BuddyState = 'idle';
let cursor = { x: -200, y: -200, visible: false };
let pos = { x: -200, y: -200 };
let showWhenIdle = true;
let paused = false;
let bubbleOn = false;

type Mode =
  | { kind: 'follow' }
  | { kind: 'fly'; from: { x: number; y: number }; to: () => { x: number; y: number }; start: number; then: Mode }
  | { kind: 'perch'; at: { x: number; y: number } };
let mode: Mode = { kind: 'follow' };

const followTarget = () => ({ x: cursor.x + FOLLOW_OFFSET.x, y: cursor.y + FOLLOW_OFFSET.y });

// ------------------------------------------------------------ animation loop

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function frame(now: number) {
  requestAnimationFrame(frame);

  if (mode.kind === 'follow') {
    const t = followTarget();
    // Springy follow: quick but soft.
    const k = reducedMotion ? 1 : 0.38;
    pos.x += (t.x - pos.x) * k;
    pos.y += (t.y - pos.y) * k;
    if (Math.abs(t.x - pos.x) > 400 || Math.abs(t.y - pos.y) > 400) pos = { ...t };
  } else if (mode.kind === 'fly') {
    const to = mode.to();
    const p = Math.min(1, (now - mode.start) / (reducedMotion ? 1 : FLY_MS));
    const e = ease(p);
    // Quadratic Bézier with the control point lifted above the path: a little arc.
    const mx = (mode.from.x + to.x) / 2;
    const my = Math.min(mode.from.y, to.y) - Math.min(140, Math.hypot(to.x - mode.from.x, to.y - mode.from.y) * 0.25);
    const u = 1 - e;
    pos.x = u * u * mode.from.x + 2 * u * e * mx + e * e * to.x;
    pos.y = u * u * mode.from.y + 2 * u * e * my + e * e * to.y;
    if (p >= 1) mode = mode.then;
  } else {
    pos = { ...mode.at };
  }

  buddy.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  placeBubble();
  updateVisibility();
}
requestAnimationFrame(frame);

function updateVisibility() {
  const perched = mode.kind !== 'follow';
  const active = state !== 'idle';
  const visible = !paused && (perched || (cursor.visible && (active || showWhenIdle)));
  buddy.classList.toggle('hidden', !visible);
}

/** Keep the bubble on screen: flip left/up near the edges. */
function placeBubble() {
  if (!bubbleOn) return;
  const w = bubble.offsetWidth;
  const h = bubble.offsetHeight;
  bubble.classList.toggle('flip-x', pos.x + 30 + w > innerWidth - 8);
  bubble.classList.toggle('flip-y', pos.y + h + 12 > innerHeight - 8);
}

// ------------------------------------------------------------ blinking

function scheduleBlink() {
  setTimeout(
    () => {
      buddy.classList.add('blink');
      setTimeout(() => buddy.classList.remove('blink'), 130);
      scheduleBlink();
    },
    2800 + Math.random() * 3500,
  );
}
if (!reducedMotion) scheduleBlink();

// ------------------------------------------------------------ state

const PILL_TEXT: Partial<Record<BuddyState, string>> = {
  listening: 'Listening',
  transcribing: 'Hmm…',
  thinking: 'Thinking',
  working: 'Working on it',
};
let agentText = '';

function setState(s: BuddyState) {
  state = s;
  buddy.className = buddy.className.replace(/\bstate-\S+/g, '').trim() + ` state-${s}`;
  const label = s === 'working' && agentText ? agentText : PILL_TEXT[s];
  if (label && mode.kind === 'follow') {
    pillText.textContent = label;
    pill.classList.add('show');
  } else if (mode.kind === 'follow') {
    pill.classList.remove('show');
  }
  if (s === 'listening' || s === 'idle') setBubble({ text: '', done: true });
}

function setBubble(m: BubbleMsg) {
  bubbleText.textContent = m.text;
  bubbleOn = !!m.text;
  bubble.classList.toggle('show', bubbleOn);
  if (bubbleOn && mode.kind === 'follow') pill.classList.remove('show');
}

// ------------------------------------------------------------ pointing

function addShape(p: PointMsg): { x: number; y: number } {
  const s = p.shape!;
  let el: SVGElement;
  let perch = { x: p.x, y: p.y }; // where the buddy sits so it doesn't cover the drawing
  if (s.kind === 'circle') {
    el = document.createElementNS(SVG_NS, 'circle');
    el.setAttribute('cx', String(p.x));
    el.setAttribute('cy', String(p.y));
    el.setAttribute('r', String(s.r));
    perch = { x: p.x + s.r * 0.72, y: p.y + s.r * 0.72 };
  } else if (s.kind === 'box') {
    el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', String(p.x));
    el.setAttribute('y', String(p.y));
    el.setAttribute('width', String(Math.max(4, s.w)));
    el.setAttribute('height', String(Math.max(4, s.h)));
    el.setAttribute('rx', '6');
    el.classList.add('box');
    perch = { x: p.x + s.w, y: p.y + s.h };
  } else {
    el = document.createElementNS(SVG_NS, 'line');
    el.setAttribute('x1', String(s.fromX));
    el.setAttribute('y1', String(s.fromY));
    el.setAttribute('x2', String(p.x));
    el.setAttribute('y2', String(p.y));
    el.setAttribute('marker-end', 'url(#arrowhead)');
    perch = { x: s.fromX, y: s.fromY };
  }
  el.setAttribute('pathLength', '1');
  el.classList.add('shape');
  draw.appendChild(el);
  return perch;
}

function clearShapes() {
  for (const el of [...draw.querySelectorAll('.shape')]) {
    el.classList.add('fading');
    setTimeout(() => el.remove(), 300);
  }
}

function pointAt(p: PointMsg) {
  const from = { ...pos };
  const at = p.shape ? addShape(p) : { x: p.x, y: p.y };
  mode = { kind: 'fly', from, to: () => at, start: performance.now(), then: { kind: 'perch', at } };
  buddy.classList.add('pointing');
  target.style.transform = `translate(${p.x}px, ${p.y}px)`;
  target.classList.toggle('show', !p.shape);
  if (p.label) {
    pillText.textContent = p.label;
    pill.classList.add('show');
  } else {
    pill.classList.remove('show');
  }
}

function release() {
  target.classList.remove('show');
  clearShapes();
  buddy.classList.remove('pointing');
  if (mode.kind === 'follow') return;
  if (state === 'working' && agentText) pillText.textContent = agentText;
  else pill.classList.remove('show');
  if (!cursor.visible) {
    // Cursor is on another screen: just fade out here.
    mode = { kind: 'follow' };
    return;
  }
  mode = { kind: 'fly', from: { ...pos }, to: followTarget, start: performance.now(), then: { kind: 'follow' } };
}

// ------------------------------------------------------------ messages

perch.on('overlay:cursor', (c: CursorMsg) => {
  const wasVisible = cursor.visible;
  cursor = c;
  if (c.visible && !wasVisible && mode.kind === 'follow') pos = followTarget();
});
perch.on('overlay:state', (m: { state: BuddyState }) => setState(m.state));
perch.on('overlay:bubble', (m: BubbleMsg) => setBubble(m));
perch.on('overlay:point', (m: PointMsg) => pointAt(m));
perch.on('overlay:release', () => release());
perch.on('overlay:level', (level: number) => buddy.style.setProperty('--level', String(level)));
perch.on('overlay:pill', (m: { text: string }) => {
  agentText = m.text;
  if (state === 'working' && mode.kind === 'follow' && agentText) {
    pillText.textContent = agentText;
    pill.classList.add('show');
  }
});
perch.on('overlay:settings', (s: { showWhenIdle: boolean }) => (showWhenIdle = s.showWhenIdle));
perch.on('overlay:visible', (v: boolean) => (paused = !v));

// Design preview in a normal browser: overlay.html?demo
if (new URLSearchParams(location.search).has('demo')) {
  document.body.style.background = '#e9edf3';
  window.addEventListener('mousemove', (e) => (cursor = { x: e.clientX, y: e.clientY, visible: true }));
  (window as any).demo = { setState, setBubble, pointAt, release, cursor: (x: number, y: number) => (cursor = { x, y, visible: true }) };
}
