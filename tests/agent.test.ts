import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, extractJson, formatElements, looksLikeActionRequest, needsApproval, parseAgentCommand, parseStep } from '../src/main/agent/actions';
import { parseCombo } from '../src/main/agent/keys';
import { trimHistory } from '../src/main/agent/history';
import { htmlToText, parseDdgHtml } from '../src/main/agent/web';
import { knownApp, searchUrl } from '../src/main/agent/apps';

// ---------------------------------------------------------------- trigger

test('agent trigger: plain "agent"', () => {
  assert.equal(parseAgentCommand('Agent, find me three laptops.'), 'find me three laptops.');
});
test('agent trigger: "Perch agent" and mishearings', () => {
  assert.equal(parseAgentCommand('Perch agent open notepad'), 'open notepad');
  assert.equal(parseAgentCommand('Hey Birch, agent: write a poem'), 'write a poem');
  assert.equal(parseAgentCommand('okay perch agent - search flights'), 'search flights');
});
test('agent trigger: filler words and mishearings', () => {
  assert.equal(parseAgentCommand('So agent, open Chrome'), 'open Chrome');
  assert.equal(parseAgentCommand('Agents, open a new tab'), 'open a new tab');
  assert.equal(parseAgentCommand('Okay, please agent open notepad'), 'open notepad');
});

test('agent trigger: normal questions are not agent tasks', () => {
  assert.equal(parseAgentCommand('What does the agent setting do?'), null);
  assert.equal(parseAgentCommand('What do agents do?'), null);
  assert.equal(parseAgentCommand('agent'), null);
});

// ---------------------------------------------------------------- JSON

test('extractJson finds the object inside prose and code fences', () => {
  const r = extractJson('Sure!\n```json\n{"say":"hi","action":{"type":"done","summary":"ok {not json}"}}\n```');
  assert.deepEqual(r, { say: 'hi', action: { type: 'done', summary: 'ok {not json}' } });
});
test('extractJson rejects incomplete objects', () => {
  assert.throws(() => extractJson('{"a": 1'));
  assert.throws(() => extractJson('no json here'));
});

test('parseStep: click with defaults', () => {
  const s = parseStep({ thought: 't', say: 'Clicking Save', action: { type: 'click', x: '120', y: 40, target: 'Save button' } });
  assert.deepEqual(s.action, { type: 'click', x: 120, y: 40, target: 'Save button', button: 'left', double: false, risky: false });
  assert.equal(s.say, 'Clicking Save');
});
test('parseStep: flat action and aliases', () => {
  assert.equal(parseStep({ type: 'double_click', x: 1, y: 2 }).action.type, 'click');
  assert.deepEqual(parseStep({ action: { type: 'hotkey', key: 'ctrl+s' } }).action, { type: 'key', keys: 'ctrl+s', target: '', risky: false });
  assert.equal(parseStep({ action: { type: 'open_app', app: 'notepad' } }).action.type, 'open');
});
test('parseStep: errors explain what is wrong', () => {
  assert.throws(() => parseStep({ action: { type: 'click', x: 'abc', y: 2 } }), /coordinate/);
  assert.throws(() => parseStep({ action: { type: 'type' } }), /text/);
  assert.throws(() => parseStep({ action: { type: 'dance' } }), /Unknown action/);
});

// ---------------------------------------------------------------- safety

test('needsApproval: risky words and flags', () => {
  const click = (target: string, risky = false) => parseStep({ action: { type: 'click', x: 1, y: 1, target, risky } }).action;
  assert.equal(needsApproval(click('Send button'), 'risky'), true);
  assert.equal(needsApproval(click('Place order'), 'risky'), true);
  assert.equal(needsApproval(click('Delete file'), 'risky'), true);
  assert.equal(needsApproval(click('File menu'), 'risky'), false);
  assert.equal(needsApproval(click('Something', true), 'risky'), true);
});
test('needsApproval: sensitive fields and destructive keys', () => {
  const type = (target: string) => parseStep({ action: { type: 'type', text: 'x', target } }).action;
  assert.equal(needsApproval(type('password field'), 'risky'), true);
  assert.equal(needsApproval(type('search box'), 'risky'), false);
  const key = (keys: string) => parseStep({ action: { type: 'key', keys } }).action;
  assert.equal(needsApproval(key('shift+delete'), 'risky'), true);
  assert.equal(needsApproval(key('alt+f4'), 'risky'), true);
  assert.equal(needsApproval(key('ctrl+c'), 'risky'), false);
});
test('needsApproval: "every" asks for any screen action but not research', () => {
  assert.equal(needsApproval(parseStep({ action: { type: 'scroll', x: 1, y: 1 } }).action, 'every'), true);
  assert.equal(needsApproval(parseStep({ action: { type: 'web_search', query: 'q' } }).action, 'every'), false);
});
test('describe gives a readable line', () => {
  assert.equal(describe(parseStep({ action: { type: 'click', x: 1, y: 1, target: 'Send' } }).action), 'Click Send');
  assert.equal(describe(parseStep({ action: { type: 'read_webpage', url: 'https://example.com/a' } }).action), 'Read example.com');
});

// ---------------------------------------------------------------- keys

test('parseCombo: modifiers first, names and letters', () => {
  assert.deepEqual(parseCombo('s+ctrl+shift').map((k) => k.vk), [0x11, 0x10, 0x53]);
  assert.deepEqual(parseCombo('Enter'), [{ vk: 0x0d, ext: false }]);
  assert.deepEqual(parseCombo('alt + f4').map((k) => k.vk), [0x12, 0x73]);
  assert.equal(parseCombo('up')[0].ext, true);
  assert.deepEqual(parseCombo('ctrl++').map((k) => k.vk), [0x11, 0xbb]);
  assert.throws(() => parseCombo('ctrl+banana'), /Unknown key/);
});

// ---------------------------------------------------------------- history

test('trimHistory keeps the task, alternates turns, and only the newest image', () => {
  const img = { data: 'x', width: 1, height: 1 };
  const h = [{ role: 'user' as const, text: 'task', image: img }];
  for (let i = 0; i < 30; i++) {
    h.push({ role: 'assistant' as const, text: `a${i}` } as any);
    h.push({ role: 'user' as const, text: `r${i}`, image: img });
  }
  const t = trimHistory(h, 6);
  assert.equal(t[0].text.startsWith('task'), true);
  assert.equal(t[1].role, 'assistant');
  assert.equal(t.filter((m) => m.image).length, 1);
  assert.equal(t[t.length - 1].image, img);
  for (let i = 1; i < t.length; i++) assert.notEqual(t[i].role, t[i - 1].role);
});

// ---------------------------------------------------------------- web

test('parseDdgHtml reads titles, real URLs and snippets', () => {
  const html = `
    <div class="result results_links results_links_deep web-result ">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&amp;rut=abc">Example &amp; Co</a></h2>
      <a class="result__snippet" href="#">The <b>best</b> example page.</a>
    </div>
    <div class="result result--ad"><a class="result__a" href="https://ads.example">Ad</a></div>
    <div class="result results_links"><h2><a class="result__a" href="https://second.org/">Second</a></h2>
      <div class="result__snippet">Another one</div></div>`;
  assert.deepEqual(parseDdgHtml(html), [
    { title: 'Example & Co', url: 'https://example.com/page?a=1', snippet: 'The best example page.' },
    { title: 'Second', url: 'https://second.org/', snippet: 'Another one' },
  ]);
});

test('htmlToText strips scripts, menus and tags', () => {
  const { title, text } = htmlToText(
    '<html><head><title>Hi &amp; bye</title><style>x{}</style></head><body><nav>Menu</nav><h1>Header</h1><p>Para one.</p><script>evil()</script><ul><li>A</li><li>B</li></ul></body></html>',
  );
  assert.equal(title, 'Hi & bye');
  assert.equal(text.includes('evil'), false);
  assert.equal(text.includes('Menu'), false);
  assert.match(text, /Header\nPara one\.\n• A\n• B/);
});

test('knownApp maps spoken app names', () => {
  assert.equal(knownApp('Chrome'), 'chrome');
  assert.equal(knownApp('google chrome'), 'chrome');
  assert.equal(knownApp('Microsoft Edge'), 'msedge');
  assert.equal(knownApp('calculator'), 'calc');
  assert.equal(knownApp('File Explorer'), 'explorer');
  assert.equal(knownApp('settings'), 'ms-settings:');
  assert.equal(knownApp('Some Random Game'), null);
});

test('browser_search builds a Google URL', () => {
  assert.equal(searchUrl('what is clicky'), 'https://www.google.com/search?q=what%20is%20clicky');
  assert.equal(parseStep({ action: { type: 'browser_search', query: 'clicky' } }).action.type, 'browser_search');
});

test('looksLikeActionRequest: action requests go to the agent', () => {
  for (const q of [
    'Can you search for clicking?',
    'open a new chrome tab and search for clicky and tell me what clicky does',
    'Please open Notepad',
    'Hey Perch, could you please type my address',
    'go to youtube.com',
    'Search Google for flights to Delhi',
    'I want you to write a leave letter',
  ]) {
    assert.equal(looksLikeActionRequest(q), q.trim(), q);
  }
});
test('looksLikeActionRequest: questions stay in chat', () => {
  for (const q of [
    'How do I open a new tab?',
    'What does this button do?',
    'Show me where the save button is',
    'Where is the search bar',
    'Is this email safe to open?',
    'Can you see my screen?',
    'Why is Chrome so slow',
  ]) {
    assert.equal(looksLikeActionRequest(q), null, q);
  }
});

test('click_element and type_into parse, describe and need approval when risky', () => {
  const c = parseStep({ action: { type: 'click_element', id: '3' } }).action;
  assert.deepEqual(c, { type: 'click_element', id: 3, target: '', button: 'left', double: false, risky: false });
  const t = parseStep({ action: { type: 'type_into', id: 2, text: 'hello' } }).action;
  assert.equal((t as any).replace, true);
  assert.equal(describe({ ...(c as any), target: 'button "Send"' }), 'Click button "Send"');
  assert.equal(needsApproval({ ...(c as any), target: 'button "Send"' }, 'risky'), true);
  assert.equal(needsApproval({ ...(c as any), target: 'tab "Inbox"' }, 'risky'), false);
  assert.throws(() => parseStep({ action: { type: 'click_element' } }), /coordinate|number/);
});

test('formatElements numbers controls and hides passwords', () => {
  const out = formatElements({
    title: 'Inbox - Gmail',
    app: 'chrome',
    items: [
      { t: 'button', n: 'Compose', v: '', p: false },
      { t: 'edit', n: 'Search mail', v: 'invoice', p: false },
      { t: 'edit', n: 'Password', v: '', p: true },
    ],
  });
  assert.match(out, /\[1\] button "Compose"/);
  assert.match(out, /\[2\] edit "Search mail" value="invoice"/);
  assert.match(out, /\[3\] edit "Password" \(password field: never type here\)/);
  assert.match(formatElements({ title: 'X', app: 'y', items: [] }), /No named controls/);
});

// ---------------------------------------------------------------- security: typing secrets (TDD)
import { blockedReason } from '../src/main/agent/actions';

test('the agent is blocked from typing card numbers, keys or passwords', () => {
  const type = (text: string) => parseStep({ action: { type: 'type', text } }).action;
  assert.match(blockedReason(type('4111 1111 1111 1111')) ?? '', /card number/);
  assert.match(blockedReason(type('sk-ant-api03-AbCdEf1234567890xyzXYZ')) ?? '', /API key/);
  assert.match(blockedReason(type('password: hunter2')) ?? '', /password/);
});

test('the agent may type ordinary text', () => {
  const type = (text: string) => parseStep({ action: { type: 'type', text } }).action;
  assert.equal(blockedReason(type('best laptops under 60000 rupees')), null);
  assert.equal(blockedReason(type('Dear Priya,\nI will be on leave tomorrow.')), null);
});

test('typing into a password field is blocked even if the text looks harmless', () => {
  const into = parseStep({ action: { type: 'type', text: 'hunter2', target: 'Password field' } }).action;
  assert.match(blockedReason(into) ?? '', /password/i);
});

test('blockedReason only applies to typing', () => {
  assert.equal(blockedReason(parseStep({ action: { type: 'web_search', query: '4111 1111 1111 1111' } }).action), null);
});
