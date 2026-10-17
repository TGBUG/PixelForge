// Boots the Electron shell headlessly long enough to prove it works, then exits.
// Modes: `run` (default — list + detail + run + preview + save), `detail`, `list`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// A valid 1x1 PNG so the app can decode the preview.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('electron is not installed; run `npm install` first');
  process.exit(1);
}

const mode = process.argv[2] || 'run';
const env = { ...process.env, PIXELFORGE_SMOKE: mode };
let tempRoot = null;

if (mode === 'run' || mode === 'error' || mode === 'cancel') {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-smoke-'));
  const input = path.join(tempRoot, 'input.png');
  fs.writeFileSync(input, PNG);
  env.PIXELFORGE_SMOKE_INPUT = input;
  if (mode === 'run') {
    const saveDir = path.join(tempRoot, 'saved');
    fs.mkdirSync(saveDir);
    env.PIXELFORGE_SAVE_DIR = saveDir;
  }
}

const cleanup = () => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
};

const fail = (message, output) => {
  cleanup();
  console.error(`smoke: ${message}`);
  if (output) console.error(output);
  process.exit(1);
};

const child = spawn(electronPath, ['.'], {
  cwd: appRoot,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const timeout = setTimeout(() => {
  child.kill();
  fail('timed out waiting for the renderer to report ready', output);
}, 30_000);

child.on('exit', (code) => {
  clearTimeout(timeout);

  const list = output.match(/\[smoke\] plugins=(\d+) errors=(\d+)/);
  if (!list) fail(`shell did not report ready (exit ${code})`, output);
  const [, plugins, errors] = list;
  console.log(`smoke: ok — shell rendered ${plugins} plugin(s), ${errors} error(s)`);

  if (mode === 'detail' || mode === 'run') {
    const detail = output.match(/\[smoke\] detail=(.+)/);
    if (!detail) fail('detail view did not render', output);
    const fields = JSON.parse(detail[1]);
    for (const key of ['name', 'author', 'version', 'description']) {
      if (!fields[key]) fail(`detail view missing "${key}" (${detail[1]})`);
    }
    console.log(`smoke: detail ok — ${fields.name} / ${fields.author} / ${fields.version}`);
  }

  if (mode === 'run') {
    const line = output.match(/\[smoke\] run=(.+)/);
    if (!line) fail('run did not report', output);
    const run = JSON.parse(line[1]);
    if (run.status !== 'success') fail(`run failed: ${JSON.stringify(run)}`, output);
    if (!run.preview) fail('run produced no preview', output);
    if (!(run.logs > 0)) fail('run produced no log output', output);
    if (!(run.progress > 0)) fail('run produced no progress', output);
    if (!Array.isArray(run.saved) || run.saved.length === 0) fail('save produced no files', output);
    for (const savedPath of run.saved) {
      if (!fs.existsSync(savedPath)) fail(`saved file missing: ${savedPath}`, output);
    }
    console.log(`smoke: run ok — preview + ${run.logs} log(s), saved ${run.saved.length} file(s)`);
  }

  if (mode === 'error') {
    const line = output.match(/\[smoke\] run=(.+)/);
    if (!line) fail('error run did not report', output);
    const run = JSON.parse(line[1]);
    if (run.status !== 'error') fail(`expected an error, got ${JSON.stringify(run)}`, output);
    if (!run.error) fail('error message was empty', output);
    console.log(`smoke: error ok — ${run.error}`);
  }

  if (mode === 'cancel') {
    const line = output.match(/\[smoke\] run=(.+)/);
    if (!line) fail('cancel run did not report', output);
    const run = JSON.parse(line[1]);
    if (run.status !== 'cancelled') fail(`expected cancelled, got ${JSON.stringify(run)}`, output);
    if (!(run.progress > 0)) fail('cancel run saw no progress before cancelling', output);
    console.log('smoke: cancel ok — live progress seen, run cancelled');
  }

  cleanup();
  process.exit(0);
});
