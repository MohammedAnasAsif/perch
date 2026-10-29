// IPC hardening: the main process only listens to Perch's own pages, and checks
// every payload before using it. See tests/guards.test.ts.

/** Only pages served from perch://app/ may talk to the main process. */
export function isTrustedSender(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.startsWith('perch://app/');
}

/** Which page may use which channel prefix. The overlay only receives. */
const CHANNEL_PAGES: Record<string, string> = {
  engine: 'engine.html',
  panel: 'panel.html',
  confirm: 'confirm.html',
};

export function channelAllowedFrom(channel: string, url: string | undefined | null): boolean {
  if (!isTrustedSender(url)) return false;
  const page = CHANNEL_PAGES[channel.split(':')[0]];
  if (!page) return false;
  const path = new URL(url!).pathname.replace(/^\/+/, '');
  return path === page;
}

type Check = (x: unknown) => boolean;

/** Small payload validators. */
export const v = {
  str:
    (max: number): Check =>
    (x) =>
      typeof x === 'string' && x.length <= max,
  bool: ((x: unknown) => typeof x === 'boolean') as Check,
  int:
    (min: number, max: number): Check =>
    (x) =>
      typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max,
  num:
    (min: number, max: number): Check =>
    (x) =>
      typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max,
  oneOf:
    (...values: string[]): Check =>
    (x) =>
      typeof x === 'string' && values.includes(x),
  uuid: ((x: unknown) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)) as Check,
  object: ((x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)) as Check,
  any: (() => true) as Check,
  none: ((x: unknown) => x === undefined) as Check,
};

interface IpcLike {
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown;
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): unknown;
}

function allowed(channel: string, event: any, args: unknown[], checks: Check[]): boolean {
  const url = event?.senderFrame?.url;
  if (!channelAllowedFrom(channel, url)) {
    console.warn(`[perch] ignored "${channel}" from an untrusted page`);
    return false;
  }
  for (let i = 0; i < checks.length; i++) {
    if (!checks[i](args[i])) {
      console.warn(`[perch] ignored "${channel}": bad argument ${i + 1}`);
      return false;
    }
  }
  return true;
}

/** ipcMain.on, but only for Perch pages and valid payloads. */
export function onTrusted(ipc: IpcLike, channel: string, checks: Check[], handler: (...args: any[]) => void) {
  ipc.on(channel, (event, ...args) => {
    if (allowed(channel, event, args, checks)) handler(...args);
  });
}

/** ipcMain.handle, but only for Perch pages and valid payloads. */
export function handleTrusted(ipc: IpcLike, channel: string, checks: Check[], handler: (...args: any[]) => unknown) {
  ipc.handle(channel, (event, ...args) => {
    if (!allowed(channel, event, args, checks)) throw new Error('Request rejected.');
    return handler(...args);
  });
}
