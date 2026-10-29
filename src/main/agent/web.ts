// Free web tools for the agent: a search (DuckDuckGo's HTML results page) and a
// page reader that turns HTML into plain text. No API keys needed.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Perch/0.2';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
    return m;
  });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Real target of a DuckDuckGo redirect link (//duckduckgo.com/l/?uddg=…). */
function unwrapDdg(href: string): string {
  const h = decodeEntities(href);
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    const target = u.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : u.href;
  } catch {
    return h;
  }
}

/** Parses DuckDuckGo's HTML results page. Exported for tests. */
export function parseDdgHtml(html: string, max = 6): SearchResult[] {
  const out: SearchResult[] = [];
  // Split on each result <div>, keeping its class list (captured) to skip ads.
  const parts = html.split(/<div[^>]+class="([^"]*\bresult\b[^"]*)"/i);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const cls = parts[i];
    const block = parts[i + 1];
    if (/\bresult--ad\b/.test(cls)) continue;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    const url = unwrapDdg(a[1]);
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block);
    out.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]) : '' });
    if (out.length >= max) break;
  }
  return out;
}

export async function webSearch(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  const html = res.ok ? await res.text() : '';
  // DuckDuckGo occasionally answers automated requests with a challenge page.
  if (!res.ok || res.status === 202 || /anomaly|challenge-form/i.test(html.slice(0, 5000))) {
    throw new Error(
      'The web search is unavailable right now. If you can use the screen, open a browser and search there instead.',
    );
  }
  return parseDdgHtml(html);
}

/** HTML -> readable plain text. Exported for tests. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  body = body
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title, text };
}

const MAX_BYTES = 3_000_000;

export async function readWebpage(url: string, signal: AbortSignal, maxChars = 8000) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('That is not a valid web address.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages can be read.');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/.test(u.hostname)) {
    throw new Error('Local network addresses are not allowed.');
  }
  const res = await fetch(u, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  const type = res.headers.get('content-type') ?? '';
  if (!/text|html|xml|json/.test(type)) throw new Error(`That page isn't text (${type || 'unknown type'}).`);
  const reader = res.body?.getReader();
  let raw = '';
  if (reader) {
    const dec = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      raw += dec.decode(value, { stream: true });
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  const { title, text } = /html|xml/.test(type) ? htmlToText(raw) : { title: '', text: raw };
  const clipped = text.length > maxChars ? text.slice(0, maxChars) + '\n…(page continues)' : text;
  return { url: res.url || u.href, title, text: clipped };
}
