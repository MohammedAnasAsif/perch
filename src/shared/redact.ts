// Secret redaction: removes things that should never be sent to an AI service
// or stored (card numbers, API keys, passwords, ID numbers). Pattern-based,
// with checksums where formats have them, so ordinary numbers are left alone.
// Pure logic; see tests/redact.test.ts for the exact behaviour.

export interface RedactResult {
  text: string;
  /** Kinds of secret that were found, each listed once. */
  found: string[];
}

interface Rule {
  kind: string;
  re: RegExp;
  /** Return the replacement, or null to keep the match. */
  replace: (match: string, ...groups: string[]) => string | null;
}

const tag = (kind: string) => `[redacted ${kind}]`;

/** Luhn checksum used by payment cards. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum used by Aadhaar numbers.
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[i % 8][Number(rev[i])]];
  return c === 0;
}

/** IBAN mod-97 check. */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const RULES: Rule[] = [
  {
    kind: 'private key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => tag('private key'),
  },
  {
    kind: 'token',
    re: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}/g,
    replace: () => tag('token'),
  },
  {
    kind: 'API key',
    re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})/g,
    replace: () => tag('API key'),
  },
  {
    // "password: x", "pwd=x", "PIN: 1234" — keep the label so the sentence still reads.
    kind: 'password',
    re: /\b(password|passwd|pwd|passcode|pin|secret|api[ _-]?key)(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
    replace: (_m, label, sep) => `${label}${sep}${tag('password')}`,
  },
  {
    // "my password is Hunter2!" — only when the value looks like a secret
    // (has a digit or symbol), so "the password is wrong" is left alone.
    kind: 'password',
    re: /\b(password|passwd|passcode|pin|pin code)(\s+(?:is|was)\s+)(\S*[\d!@#$%^&*_+=?~][^\s,;.]*[^\s,;.!?]?|\S*[\d!@#$%^&*_+=?~])/gi,
    replace: (_m, label, sep) => `${label}${sep}${tag('password')}`,
  },
  {
    kind: 'IBAN',
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    replace: (m) => (ibanValid(m) ? tag('IBAN') : null),
  },
  {
    kind: 'card number',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? tag('card number') : null;
    },
  },
  {
    kind: 'Aadhaar number',
    re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
    replace: (m) => (verhoeffValid(m.replace(/\D/g, '')) ? tag('Aadhaar number') : null),
  },
  {
    kind: 'PAN',
    re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g,
    replace: () => tag('PAN'),
  },
];

export function redactSecrets(input: string): RedactResult {
  if (!input) return { text: input, found: [] };
  const found = new Set<string>();
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.re, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((g) => typeof g === 'string') as string[];
      const out = rule.replace(match, ...groups);
      if (out === null) return match;
      found.add(rule.kind);
      return out;
    });
  }
  return { text, found: [...found] };
}

export function containsSecret(text: string): boolean {
  return redactSecrets(text).found.length > 0;
}
