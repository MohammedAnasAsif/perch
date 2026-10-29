// "Private apps": windows Perch never screenshots and the agent never acts in
// (password managers, banking and payment pages, Windows security prompts, and
// anything the user adds). Pure logic; see tests/guards.test.ts.

export interface WindowInfo {
  /** Process name, e.g. "chrome" or "Bitwarden". */
  app: string;
  title: string;
}

const PASSWORD_MANAGERS =
  /\b(1password|bitwarden|keepass(?:xc)?|lastpass|dashlane|keeper|nordpass|proton ?pass|enpass|roboform|password manager)\b/i;
const SECURITY_APPS = /^(credentialuibroker|consent|logonui|lockapp)$/i;
const SECURITY_TITLES = /^(windows security|user account control)$/i;
const MONEY =
  /\b(net ?banking|online banking|internet banking|mobile banking|bank|banking|paypal|razorpay|paytm|phonepe|google pay|gpay|upi|billdesk|ccavenue|checkout|payment|pay with|card details|wallet)\b/i;

/** Why this window is private, or null if Perch may look at it. */
export function privateReason(w: WindowInfo, custom: string[]): string | null {
  const app = (w.app ?? '').trim();
  const title = (w.title ?? '').trim();
  if (!app && !title) return null;

  if (PASSWORD_MANAGERS.test(app) || PASSWORD_MANAGERS.test(title)) return 'a password manager is open';
  if (SECURITY_APPS.test(app) || SECURITY_TITLES.test(title)) return 'a Windows security prompt is open';
  if (MONEY.test(title)) return 'a banking or payment page is open';

  const hay = `${app}\n${title}`.toLowerCase();
  for (const raw of custom) {
    const entry = raw.trim().toLowerCase();
    if (entry && hay.includes(entry)) return `"${raw.trim()}" is on your private list`;
  }
  return null;
}

/** Parses the comma/newline separated list from settings. */
export function parsePrivateList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50);
}
