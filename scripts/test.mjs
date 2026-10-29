// Bundles each tests/*.test.ts with esbuild and runs them with Node's test runner.
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.test-build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts'));
await build({
  entryPoints: files.map((f) => join(root, 'tests', f)),
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const r = spawnSync(process.execPath, ['--test', ...files.map((f) => join(out, f.replace(/\.ts$/, '.mjs')))], {
  stdio: 'inherit',
});
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
