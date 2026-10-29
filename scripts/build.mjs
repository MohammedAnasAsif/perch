// Bundles Perch with esbuild.
//   main + preload  -> dist/*.js       (Node/Electron, CommonJS)
//   renderer pages  -> dist/renderer/  (browser, ESM)
// Usage: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'renderer', 'ort'), { recursive: true });

// Static files: HTML, CSS, icons.
cpSync(join(root, 'src', 'renderer', 'static'), join(out, 'renderer'), { recursive: true });
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true });

// ONNX Runtime WebAssembly files, served locally so speech recognition works offline.
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  if (!existsSync(join(ortDist, f))) throw new Error(`Missing ${f} in onnxruntime-web. Run npm install.`);
  cpSync(join(ortDist, f), join(out, 'renderer', 'ort', f));
}

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

const configs = [
  {
    ...common,
    entryPoints: { main: 'src/main/main.ts', preload: 'src/preload/preload.ts' },
    outdir: out,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'uiohook-napi'],
  },
  {
    ...common,
    entryPoints: {
      overlay: 'src/renderer/overlay.ts',
      panel: 'src/renderer/panel.ts',
      engine: 'src/renderer/engine.ts',
      'stt-worker': 'src/renderer/stt-worker.ts',
    },
    outdir: join(out, 'renderer'),
    platform: 'browser',
    format: 'esm',
  },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log('Watching for changes…');
} else {
  await Promise.all(configs.map((c) => build(c)));
}
