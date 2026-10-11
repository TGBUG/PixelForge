// Boots the Electron shell headlessly long enough to prove it reaches a
// populated plugin list, then exits. Run with `npm run smoke -w @pixelforge/app`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('electron is not installed; run `npm install` first');
  process.exit(1);
}

// `list` only checks the plugin list; `detail` (the default) also opens the
// first plugin so the documented `npm run smoke` covers both acceptance paths.
const mode = process.argv[2] || 'detail';

const child = spawn(electronPath, ['.'], {
  cwd: appRoot,
  env: { ...process.env, PIXELFORGE_SMOKE: mode },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const timeout = setTimeout(() => {
  child.kill();
  console.error('smoke: timed out waiting for the renderer to report ready');
  console.error(output);
  process.exit(1);
}, 30_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  const match = output.match(/\[smoke\] plugins=(\d+) errors=(\d+)/);
  if (!match) {
    console.error(`smoke: shell did not report ready (exit ${code})`);
    console.error(output);
    process.exit(1);
  }
  const [, plugins, errors] = match;
  console.log(`smoke: ok — shell rendered ${plugins} plugin(s), ${errors} error(s)`);

  if (mode === 'detail' && Number(plugins) > 0) {
    const detail = output.match(/\[smoke\] detail=(.+)/);
    if (!detail) {
      console.error('smoke: detail view did not render');
      console.error(output);
      process.exit(1);
    }
    const fields = JSON.parse(detail[1]);
    for (const key of ['name', 'author', 'version', 'description']) {
      if (!fields[key]) {
        console.error(`smoke: detail view missing "${key}" (${detail[1]})`);
        process.exit(1);
      }
    }
    console.log(`smoke: detail ok — ${fields.name} / ${fields.author} / ${fields.version}`);
  }

  process.exit(0);
});
