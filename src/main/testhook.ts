// Integration and acceptance tests drive the real app through this hook. It
// only runs in development builds started with PERCH_TEST_SCRIPT set; an
// installed (packaged) Perch ignores it completely.
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';

export interface Harness {
  [key: string]: unknown;
}

export function maybeRunTestScript(build: () => Harness) {
  const script = process.env.PERCH_TEST_SCRIPT;
  if (!script) return;
  if (app.isPackaged) {
    console.warn('[perch] PERCH_TEST_SCRIPT is ignored in installed builds');
    return;
  }

  // Linux test machines have no keyring; use Electron's test-only fallback so
  // encrypted storage can be exercised. (Windows always uses DPAPI.)
  if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption?.(true);

  const logs: string[] = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    const orig = console[m].bind(console);
    console[m] = (...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
      orig(...a);
    };
  }

  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const finish = (code?: number) => {
    const failed = results.filter((r) => !r.ok);
    process.stdout.write(`PERCH_TEST_RESULT ${JSON.stringify({ results, failed: failed.length })}\n`);
    setTimeout(() => app.exit(code ?? (failed.length ? 1 : 0)), 50);
  };

  const h = {
    ...build(),
    app,
    ipcMain,
    BrowserWindow,
    logs,
    wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    async waitFor(pred: () => unknown, timeout = 10_000, what = 'condition') {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await pred()) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timed out waiting for ${what}`);
    },
    check(ok: unknown, name: string, detail?: unknown) {
      results.push({ name, ok: !!ok, detail: ok ? undefined : JSON.stringify(detail ?? null)?.slice(0, 500) });
      console.log(`[test] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` -> ${JSON.stringify(detail ?? null)?.slice(0, 300)}`}`);
    },
    /** Runs JavaScript inside one of Perch's windows (like a user acting on the page). */
    exec(win: BrowserWindow | null | undefined, js: string) {
      if (!win || win.isDestroyed()) throw new Error('window not available');
      return win.webContents.executeJavaScript(js, true);
    },
    findWindow(page: string) {
      return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes(page)) ?? null;
    },
    finish,
  };

  setTimeout(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const run = require(script);
      await (run.default ?? run)(h);
      finish();
    } catch (err) {
      const tail = logs.filter((l) => /\[(perch|agent|test|engine)\]/.test(l)).slice(-25).join('\n');
      results.push({ name: 'script crashed', ok: false, detail: `${String((err as Error)?.stack ?? err).slice(0, 800)}\n--- recent log ---\n${tail}` });
      finish(1);
    }
  }, 1500);
}
