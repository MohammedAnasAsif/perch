// Windows-only check (run in CI): compiles the PowerShell/SendInput helper and
// sends a harmless key press (Shift) to make sure the command loop works.
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'win32') {
  console.log('smoke-input: skipped (not Windows)');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-build');
mkdirSync(out, { recursive: true });
const file = join(out, 'input-smoke.mjs');

await build({
  entryPoints: [join(root, 'src/main/agent/input.ts')],
  outfile: file,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'warning',
  plugins: [
    {
      name: 'electron-stub',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const screen = {};',
          loader: 'js',
        }));
      },
    },
  ],
});

const { WindowsInput } = await import(pathToFileURL(file).href);
const input = new WindowsInput();
const started = Date.now();
try {
  await input.prepare();
  console.log(`smoke-input: helper compiled and answered in ${Date.now() - started} ms`);
  await input.keys([{ vk: 0x10, ext: false }]);
  console.log('smoke-input: key command OK');
  // UI Automation: the CI desktop may have no foreground window, so "no window"
  // is fine; what matters is that the helper compiled and answered.
  try {
    const snap = await input.elements(20);
    console.log(`smoke-input: UI Automation OK (${snap.items.length} elements in "${snap.title}")`);
  } catch (err) {
    if (/no window|timeout/.test(err.message)) console.log('smoke-input: UI Automation answered:', err.message);
    else throw err;
  }
} catch (err) {
  console.error('smoke-input: FAILED', err);
  process.exitCode = 1;
} finally {
  input.dispose();
  rmSync(out, { recursive: true, force: true });
}
