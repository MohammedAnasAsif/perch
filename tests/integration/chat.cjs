// Integration: a normal chat answer with pointing and drawing.
const { fakeAI, recordOverlay } = require('./_helpers.cjs');

module.exports = async (h) => {
  const overlay = recordOverlay(h);
  const calls = fakeAI(h, [
    'Sure. [POINT:300,40:Insert tab]Click the Insert tab. [CIRCLE:500,60,20:Page Number]Then choose Page Number.',
  ]);

  h.companion.askTyped('How do I add page numbers?');
  await h.waitFor(() => h.companion.status().lastAnswer, 10000, 'an answer');
  await h.waitFor(() => h.companion.currentState() === 'idle', 15000, 'buddy back to idle');

  const req = calls[0];
  h.check(req && req.messages.at(-1).text.startsWith('How do I add page numbers?'), 'question is sent to the AI', req?.messages.at(-1).text);
  h.check(!!req?.messages.at(-1).image, 'a screenshot is attached');
  h.check(/POINT/.test(req?.system ?? ''), 'system prompt explains pointing');

  const answer = h.companion.status().lastAnswer;
  h.check(answer === 'Sure. Click the Insert tab. Then choose Page Number.', 'tags are removed from the shown answer', answer);

  const points = overlay.filter((m) => m.ch === 'overlay:point').map((m) => m.d);
  h.check(points.length === 2, 'buddy points twice', points);
  h.check(points[0]?.label === 'Insert tab' && !points[0]?.shape, 'first is a plain point', points[0]);
  h.check(points[1]?.shape?.kind === 'circle', 'second draws a circle', points[1]);
  h.check(overlay.some((m) => m.ch === 'overlay:release'), 'buddy flies back afterwards');
};
