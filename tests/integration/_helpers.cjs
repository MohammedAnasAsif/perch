// Shared helpers for integration and acceptance scenarios (CommonJS, loaded
// inside the running app by the test hook).

/**
 * Replaces the AI with a script. `replies` is a list of strings or functions
 * (opts) => string, used in order; the last one repeats. Every request is
 * recorded in the returned array.
 */
function fakeAI(h, replies, providerId = 'claude') {
  const calls = [];
  let i = 0;
  h.providers[providerId].stream = async (opts, onText) => {
    calls.push(opts);
    const r = replies[Math.min(i++, replies.length - 1)];
    const text = typeof r === 'function' ? r(opts) : r;
    for (let k = 0; k < text.length; k += 12) {
      if (opts.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      onText(text.slice(k, k + 12));
      await new Promise((res) => setTimeout(res, 5));
    }
    return text;
  };
  return calls;
}

/** Records what Perch sends to the buddy overlay. */
function recordOverlay(h) {
  const msgs = [];
  const ov = h.overlays;
  const send = ov.send.bind(ov);
  const sendTo = ov.sendTo.bind(ov);
  ov.send = (ch, d) => {
    msgs.push({ ch, d });
    send(ch, d);
  };
  ov.sendTo = (id, ch, d) => {
    msgs.push({ ch, d, id });
    sendTo(id, ch, d);
  };
  return msgs;
}

/** Replaces mouse/keyboard control with a recorder (nothing is really clicked). */
function fakeInput(h, opts = {}) {
  const calls = [];
  const rec =
    (name, ret) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof ret === 'function' ? ret(...args) : ret;
    };
  Object.assign(h.input, {
    prepare: rec('prepare'),
    click: rec('click'),
    scroll: rec('scroll'),
    keys: rec('keys'),
    type: rec('type'),
    foregroundApp: rec('foregroundApp', opts.app ?? 'notepad'),
    foregroundWindow: rec('foregroundWindow', () => opts.window ?? { app: 'notepad', title: 'Untitled - Notepad' }),
    elements: rec('elements', () => opts.elements ?? { title: 'Untitled - Notepad', app: 'notepad', items: [] }),
  });
  return calls;
}

/** JSON for one agent step. */
const step = (say, action) => JSON.stringify({ thought: 'test', say, action });

module.exports = { fakeAI, recordOverlay, fakeInput, step };
