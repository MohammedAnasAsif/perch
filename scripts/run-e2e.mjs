// Runs Perch's integration or acceptance scenarios against the real app.
//   node scripts/run-e2e.mjs tests/integration [--no-build] [--only name]
// Each *.cjs file is one scenario. It runs in a freshly started Perch with an
// empty profile, a fake AI, and (on Linux) a virtual display.
//
// Scenario headers:
//   // @env NAME=value     set an environment variable for this scenario
//   // @unset NAME         remove one (e.g. to test first run without a key)
//   // @runs 2             start Perch twice with the same profile (persistence)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const suite = resolve(root, args.find((a) => !a.startsWith('--')) ?? 'tests/integration');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const electronPath = createRequire(import.meta.url)('electron');

if (!args.includes('--no-build')) {
  const b = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const files = readdirSync(suite)
  .filter((f) => f.endsWith('.cjs') && !f.startsWith('_'))
  .filter((f) => !only || f.includes(only))
  .sort();

function headers(file) {
  const text = readFileSync(join(suite, file), 'utf8').split('\n').slice(0, 15).join('\n');
  const env = {};
  const unset = [];
  let runs = 1;
  for (const m of text.matchAll(/\/\/ @env (\w+)=(.*)/g)) env[m[1]] = m[2].trim();
  for (const m of text.matchAll(/\/\/ @unset (\w+)/g)) unset.push(m[1]);
  const r = /\/\/ @runs (\d+)/.exec(text);
  if (r) runs = Number(r[1]);
  return { env, unset, runs };
}

function runOnce(file, profile, run, h) {
  return new Promise((done) => {
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-test-key-for-automated-tests',
      ...h.env,
      PERCH_TEST_SCRIPT: join(suite, file),
      PERCH_TEST_RUN: String(run),
      NODE_OPTIONS: '',
      ELECTRON_ENABLE_LOGGING: '1',
    };
    for (const n of h.unset) delete env[n];
    const appArgs = [root, `--user-data-dir=${profile}`, '--password-store=basic', '--dev'];
    // Root, and Linux CI runners (AppArmor blocks Chromium's sandbox there), need --no-sandbox.
    // Only the test copy of the app runs this way; real installs keep the sandbox.
    if (process.getuid?.() === 0 || (process.platform === 'linux' && process.env.CI)) appArgs.push('--no-sandbox');
    let cmd = electronPath;
    let cmdArgs = appArgs;
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      cmd = 'xvfb-run';
      cmdArgs = ['-a', '-s', '-screen 0 1280x800x24', electronPath, ...appArgs];
    }
    const child = spawn(cmd, cmdArgs, { env, cwd: root });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      out += '\n[runner] timed out after 120 s\n';
      child.kill('SIGKILL');
    }, 120_000);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('PERCH_TEST_RESULT '));
      if (!line) return done({ results: [{ name: 'scenario produced a result', ok: false, detail: out.slice(-3000) }], failed: 1 });
      done(JSON.parse(line.slice('PERCH_TEST_RESULT '.length)));
    });
  });
}

let failed = 0;
let passed = 0;
console.log(`\nRunning ${files.length} scenario(s) from ${suite.replace(root + '/', '')}\n`);
for (const file of files) {
  const h = headers(file);
  const profile = mkdtempSync(join(tmpdir(), 'perch-e2e-'));
  const t0 = Date.now();
  let all = [];
  for (let run = 1; run <= h.runs; run++) {
    const res = await runOnce(file, profile, run, h);
    all = all.concat(res.results.map((r) => ({ ...r, name: h.runs > 1 ? `[run ${run}] ${r.name}` : r.name })));
  }
  rmSync(profile, { recursive: true, force: true });
  const bad = all.filter((r) => !r.ok);
  passed += all.length - bad.length;
  failed += bad.length;
  console.log(`${bad.length ? '✗' : '✓'} ${file} (${all.length - bad.length}/${all.length} checks, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const r of bad) console.log(`    ✗ ${r.name}\n      ${String(r.detail ?? '').slice(0, 1500).replace(/\n/g, '\n      ')}`);
}
console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
