// Launching apps by name. Well-known apps start directly (more reliable than
// typing into the Start menu); anything else falls back to the Start menu.
// Pure lookup logic is exported for tests.

/** App names people say -> what Windows' "start" command runs. */
const KNOWN: [RegExp, string][] = [
  [/^(google\s+)?chrome$/, 'chrome'],
  [/^(microsoft\s+)?edge$/, 'msedge'],
  [/^(mozilla\s+)?firefox$/, 'firefox'],
  [/^brave(\s+browser)?$/, 'brave'],
  [/^(the\s+)?(web\s+)?browser$/, 'https://www.google.com'],
  [/^notepad$/, 'notepad'],
  [/^(calc|calculator)$/, 'calc'],
  [/^(ms\s+)?paint$/, 'mspaint'],
  [/^(file\s+)?explorer|files$/, 'explorer'],
  [/^(microsoft\s+)?word$/, 'winword'],
  [/^(microsoft\s+)?excel$/, 'excel'],
  [/^(microsoft\s+)?power\s?point$/, 'powerpnt'],
  [/^(microsoft\s+)?outlook$/, 'outlook'],
  [/^(cmd|command prompt)$/, 'cmd'],
  [/^(windows\s+)?terminal$/, 'wt'],
  [/^powershell$/, 'powershell'],
  [/^(vs\s?code|visual studio code|code)$/, 'code'],
  [/^(settings|windows settings)$/, 'ms-settings:'],
  [/^(snipping tool|snip)$/, 'ms-screenclip:'],
];

export function knownApp(name: string): string | null {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/\s+/g, ' ');
  for (const [re, cmd] of KNOWN) if (re.test(n)) return cmd;
  return null;
}

/** A Google search URL (opens as a new tab in the user's default browser). */
export function searchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** Programs that ship with Windows and are always on the PATH. */
export const BUILT_IN = new Set(['notepad', 'calc', 'mspaint', 'explorer', 'cmd', 'powershell']);
