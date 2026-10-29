// Written before the guards they test (TDD): private apps, local-network
// blocking (SSRF) and IPC validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateReason } from '../src/shared/privacy';
import { checkUrl, isPublicAddress } from '../src/main/netguard';
import { isTrustedSender, v } from '../src/main/ipcguard';

// ---------------------------------------------------------------- private apps

test('password managers are private', () => {
  for (const app of ['1Password', 'Bitwarden', 'KeePassXC', 'KeePass', 'LastPass', 'Dashlane', 'Keeper', 'NordPass']) {
    assert.ok(privateReason({ app, title: 'Vault' }, []), app);
  }
});

test('banking, payment and checkout pages are private', () => {
  assert.ok(privateReason({ app: 'chrome', title: 'HDFC Bank NetBanking - Google Chrome' }, []));
  assert.ok(privateReason({ app: 'msedge', title: 'Pay with UPI - Razorpay - Microsoft Edge' }, []));
  assert.ok(privateReason({ app: 'chrome', title: 'Checkout - Amazon.in - Google Chrome' }, []));
  assert.ok(privateReason({ app: 'chrome', title: 'Log in to your PayPal account' }, []));
});

test('Windows security prompts are private', () => {
  assert.ok(privateReason({ app: 'CredentialUIBroker', title: 'Windows Security' }, []));
  assert.ok(privateReason({ app: 'consent', title: 'User Account Control' }, []));
});

test('ordinary apps and pages are not private', () => {
  assert.equal(privateReason({ app: 'chrome', title: 'Clicky - Google Search - Google Chrome' }, []), null);
  assert.equal(privateReason({ app: 'WINWORD', title: 'Report.docx - Word' }, []), null);
  assert.equal(privateReason({ app: 'chrome', title: 'Riverbank walks in Pune - Google Chrome' }, []), null);
  assert.equal(privateReason({ app: '', title: '' }, []), null);
});

test('the user can add their own private apps or sites', () => {
  assert.ok(privateReason({ app: 'chrome', title: 'Payroll - acme-hr.example.com' }, ['acme-hr']));
  assert.ok(privateReason({ app: 'Signal', title: 'Signal' }, ['signal']));
  assert.equal(privateReason({ app: 'chrome', title: 'News' }, ['', '  ']), null, 'blank entries are ignored');
});

test('the reason names what was detected', () => {
  assert.match(privateReason({ app: 'Bitwarden', title: 'Bitwarden' }, []) ?? '', /password manager/);
  assert.match(privateReason({ app: 'chrome', title: 'SBI Online Banking' }, []) ?? '', /bank/i);
});

// ---------------------------------------------------------------- SSRF

test('isPublicAddress rejects loopback, private, link-local and reserved ranges', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.10',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('isPublicAddress accepts public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

const resolver = (map: Record<string, string[]>) => async (host: string) => {
  if (!(host in map)) throw new Error('ENOTFOUND');
  return map[host];
};

test('checkUrl allows public sites and blocks names that resolve to private addresses', async () => {
  const dns = resolver({ 'example.com': ['93.184.216.34'], 'evil.test': ['10.0.0.5'], 'mixed.test': ['8.8.8.8', '127.0.0.1'] });
  assert.equal(await checkUrl('https://example.com/page', dns), null);
  assert.match((await checkUrl('http://evil.test/admin', dns)) ?? '', /local network/);
  assert.match((await checkUrl('http://mixed.test/', dns)) ?? '', /local network/, 'any private answer blocks');
});

test('checkUrl blocks literal private IPs, odd ports and non-web schemes', async () => {
  const dns = resolver({});
  assert.match((await checkUrl('http://192.168.1.1/', dns)) ?? '', /local network/);
  assert.match((await checkUrl('http://[::1]:8080/', dns)) ?? '', /local network/);
  assert.match((await checkUrl('file:///C:/Windows/win.ini', dns)) ?? '', /http/);
  assert.match((await checkUrl('https://example.com:22/', resolver({ 'example.com': ['93.184.216.34'] }))) ?? '', /port/);
  assert.match((await checkUrl('not a url', dns)) ?? '', /valid/);
});

// ---------------------------------------------------------------- IPC

test('only Perch pages are trusted IPC senders', () => {
  assert.equal(isTrustedSender('perch://app/panel.html'), true);
  assert.equal(isTrustedSender('perch://app/overlay.html?display=1'), true);
  assert.equal(isTrustedSender('https://evil.example/perch://app/'), false);
  assert.equal(isTrustedSender('perch://evil/panel.html'), false);
  assert.equal(isTrustedSender('file:///C:/panel.html'), false);
  assert.equal(isTrustedSender(''), false);
  assert.equal(isTrustedSender(undefined), false);
});

test('payload validators accept good values and reject bad ones', () => {
  assert.equal(v.str(200)('hello'), true);
  assert.equal(v.str(5)('too long!'), false);
  assert.equal(v.str(10)(42), false);
  assert.equal(v.bool(true), true);
  assert.equal(v.bool('true'), false);
  assert.equal(v.int(-1, 1000)(5), true);
  assert.equal(v.int(-1, 1000)(5.5), false);
  assert.equal(v.int(0, 10)(11), false);
  assert.equal(v.oneOf('claude', 'gemini')('gemini'), true);
  assert.equal(v.oneOf('claude', 'gemini')('openai'), false);
  assert.equal(v.uuid('2b7f8f2e-8f4e-4d2a-9a6e-0c3b5d4e1f20'), true);
  assert.equal(v.uuid('../../etc/passwd'), false);
});

test('each channel is only accepted from its own page', async () => {
  const { channelAllowedFrom } = await import('../src/main/ipcguard');
  assert.equal(channelAllowedFrom('panel:ask', 'perch://app/panel.html'), true);
  assert.equal(channelAllowedFrom('engine:transcript', 'perch://app/engine.html'), true);
  assert.equal(channelAllowedFrom('confirm:answer', 'perch://app/confirm.html'), true);
  // The overlay shows things; it never sends commands.
  assert.equal(channelAllowedFrom('panel:ask', 'perch://app/overlay.html?display=1'), false);
  assert.equal(channelAllowedFrom('confirm:answer', 'perch://app/panel.html'), false);
  assert.equal(channelAllowedFrom('engine:transcript', 'perch://app/panel.html'), false);
  assert.equal(channelAllowedFrom('panel:ask', 'https://example.com/panel.html'), false);
});
