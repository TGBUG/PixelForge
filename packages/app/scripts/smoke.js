// Boots the Electron shell headlessly long enough to prove it works, then exits.
// Modes: list, detail, run (default), error, cancel, install, uninstall.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPlugin } from '@pixelforge/runtime';
import yazl from 'yazl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const FIXTURES = path.join(repoRoot, 'fixtures', 'plugins');
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

function addDirectory(zip, sourceDir, prefix) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const full = path.join(sourceDir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) addDirectory(zip, full, name);
    else zip.addFile(full, name);
  }
}

function zipDirectory(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    addDirectory(zip, sourceDir, '');
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', resolve)
      .on('error', reject);
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

async function seed(pluginsDir, ids) {
  for (const id of ids) {
    const zipPath = path.join(tempRoot, `${id}.zip`);
    await zipDirectory(path.join(FIXTURES, id), zipPath);
    const result = await installPlugin({ zipPath, pluginsDir });
    if (result.status !== 'installed') {
      throw new Error(`failed to seed ${id}: ${result.message}`);
    }
  }
}

const SEED = {
  list: ['copy-image'],
  detail: ['copy-image'],
  error: ['fixture-fail'],
  cancel: ['fixture-hang'],
  uninstall: ['copy-image'],
};

// Each mode gets a fresh plugins directory. Modes that run a plugin seed it
// through the real ZIP install path, so the app only ever sees installed plugins.
async function prepare() {
  if (!(mode in SEED) && mode !== 'install' && mode !== 'run') return;

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-smoke-'));
  const pluginsDir = path.join(tempRoot, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  env.PIXELFORGE_PLUGINS_DIR = pluginsDir;

  if (mode === 'install' || mode === 'run') {
    const zipPath = path.join(tempRoot, 'copy-image.zip');
    await zipDirectory(path.join(FIXTURES, 'copy-image'), zipPath);
    env.PIXELFORGE_SMOKE_ZIP = zipPath;
  }

  if (mode === 'uninstall') env.PIXELFORGE_SKIP_CONFIRM = '1';
  if (SEED[mode]) await seed(pluginsDir, SEED[mode]);
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

try {
  await prepare();
} catch (error) {
  fail(`setup failed: ${error.message}`);
}

const inputPath = path.join(tempRoot ?? os.tmpdir(), 'input.png');
if (['run', 'error', 'cancel'].includes(mode)) {
  fs.writeFileSync(inputPath, PNG);
  env.PIXELFORGE_SMOKE_INPUT = inputPath;
  if (mode === 'run') {
    const saveDir = path.join(tempRoot, 'saved');
    fs.mkdirSync(saveDir);
    env.PIXELFORGE_SAVE_DIR = saveDir;
  }
}

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

  const runMatch = output.match(/\[smoke\] run=(.+)/);
  const run = runMatch ? JSON.parse(runMatch[1]) : null;

  if (mode === 'run') {
    if (!run) fail('run did not report', output);
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
    if (!run) fail('error run did not report', output);
    if (run.status !== 'error') fail(`expected an error, got ${JSON.stringify(run)}`, output);
    if (!run.error) fail('error message was empty', output);
    console.log(`smoke: error ok — ${run.error}`);
  }

  if (mode === 'cancel') {
    if (!run) fail('cancel run did not report', output);
    if (run.status !== 'cancelled') fail(`expected cancelled, got ${JSON.stringify(run)}`, output);
    if (!(run.progress > 0)) fail('cancel run saw no progress before cancelling', output);
    console.log('smoke: cancel ok — live progress seen, run cancelled');
  }

  if (mode === 'install') {
    if (!run) fail('install did not report', output);
    if (run.status !== 'installed') fail(`install failed: ${JSON.stringify(run)}`, output);
    if (!run.present) fail('installed plugin is not in the list', output);
    if (!(run.count >= 1)) fail('plugin list is still empty after install', output);
    console.log(`smoke: install ok — ${run.id}, ${run.count} plugin(s)`);
  }

  if (mode === 'uninstall') {
    if (!run) fail('uninstall did not report', output);
    if (run.status !== 'removed') fail(`uninstall failed: ${JSON.stringify(run)}`, output);
    if (run.present) fail('plugin is still listed after uninstall', output);
    if (run.count !== 0) fail(`expected an empty list, got ${run.count}`, output);
    console.log('smoke: uninstall ok — plugin removed from the list');
  }

  cleanup();
  process.exit(0);
});
